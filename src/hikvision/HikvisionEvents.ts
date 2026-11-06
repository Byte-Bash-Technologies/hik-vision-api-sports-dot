import { HikvisionClient } from './HikvisionClient';
import { AcsEventItem, AcsEventSearchResponse } from './types';
import { getNeutralEventDescription } from './eventMappings';

export interface SearchEventsOptions {
  position?: number;
  maxResults?: number;
  major?: number;
  minor?: number;
  startTime?: string;
  endTime?: string;
  searchId?: string;
  employeeNo?: string;
}

export interface FormattedEventItem {
  id: string;
  time: string;
  deviceDate: string;
  deviceTime: string;
  timezoneOffset: string;
  major: number;
  minor: number;
  category: string;
  description: string;
  employeeNo: string | null;
  employeeName: string | null;
  verifyMode: string;
  verifyModeLabel: string;
  doorNo: number | null;
  cardReaderNo: number | null;
  serialNo: number | null;
  raw: AcsEventItem;
}

export interface EventSearchResult {
  searchId: string;
  totalMatches: number;
  numOfMatches: number;
  responseStatus: string;
  events: FormattedEventItem[];
  raw: unknown;
}

export class HikvisionEvents {
  constructor(private client: HikvisionClient) {}

  public formatEventItem(ev: AcsEventItem, index = 0): FormattedEventItem {
    const descInfo = getNeutralEventDescription(ev.major, ev.minor, ev.currentVerifyMode);
    const dateObj = ev.time ? new Date(ev.time) : new Date();

    let deviceDate = dateObj.toISOString().split('T')[0];
    let deviceTime = dateObj.toTimeString().split(' ')[0];
    let timezoneOffset = '';

    if (typeof ev.time === 'string') {
      const parts = ev.time.split('T');
      if (parts.length === 2) {
        deviceDate = parts[0];
        const timeMatch = /^(\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})?/.exec(parts[1]);
        if (timeMatch) {
          deviceTime = timeMatch[1];
          timezoneOffset = timeMatch[2] || '';
        }
      }
    }

    const serial = ev.serialNo !== undefined ? Number(ev.serialNo) : null;
    const employeeNo = ev.employeeNoString || null;
    const id = serial ? `event-${serial}` : `event-${dateObj.getTime()}-${index}`;

    return {
      id,
      time: dateObj.toISOString(),
      deviceDate,
      deviceTime,
      timezoneOffset,
      major: Number(ev.major),
      minor: Number(ev.minor),
      category: descInfo.category,
      description: descInfo.description,
      employeeNo,
      employeeName: ev.name || null,
      verifyMode: ev.currentVerifyMode || 'unspecified',
      verifyModeLabel: descInfo.verifyModeLabel,
      doorNo: ev.doorNo !== undefined ? Number(ev.doorNo) : null,
      cardReaderNo: ev.cardReaderNo !== undefined ? Number(ev.cardReaderNo) : null,
      serialNo: serial,
      raw: ev,
    };
  }

  public async searchEvents(options: SearchEventsOptions = {}): Promise<EventSearchResult> {
    const position = options.position ?? 0;
    const maxResults = options.maxResults ?? 30;
    const searchId = options.searchId || '1';

    const acsEventCond: Record<string, any> = {
      searchID: searchId,
      searchResultPosition: position,
      maxResults: maxResults,
      major: options.major ?? 0,
      minor: options.minor ?? 0,
    };

    if (options.startTime) {
      acsEventCond.startTime = options.startTime;
    }
    if (options.endTime) {
      acsEventCond.endTime = options.endTime;
    }
    if (options.employeeNo) {
      acsEventCond.employeeNoString = String(options.employeeNo);
    }

    const payload = {
      AcsEventCond: acsEventCond,
    };

    const raw = await this.client.post<AcsEventSearchResponse>(
      '/ISAPI/AccessControl/AcsEvent?format=json',
      payload
    );

    const acsEvent = raw.AcsEvent || {};
    const rawEvents = Array.isArray(acsEvent.InfoList) ? acsEvent.InfoList : [];
    const totalMatches = Number(acsEvent.totalMatches ?? rawEvents.length);
    const numOfMatches = Number(acsEvent.numOfMatches ?? rawEvents.length);
    const responseStatus = acsEvent.responseStatusStrg || 'OK';

    const formattedEvents = rawEvents.map((e, idx) => this.formatEventItem(e, position + idx));

    return {
      searchId: acsEvent.searchID || searchId,
      totalMatches,
      numOfMatches,
      responseStatus,
      events: formattedEvents,
      raw,
    };
  }

  public async fetchAllEvents(options: Omit<SearchEventsOptions, 'position'> = {}): Promise<FormattedEventItem[]> {
    const allEvents: FormattedEventItem[] = [];
    const targetLimit = options.maxResults;
    const batchSize = 30; // Hikvision terminal max matches per page is 30
    let position = 0;
    let total = Infinity;

    while (position < total) {
      const remaining = targetLimit ? targetLimit - allEvents.length : batchSize;
      if (remaining <= 0) break;

      const result = await this.searchEvents({
        ...options,
        position,
        maxResults: Math.min(remaining, batchSize),
      });

      if (!result.events || result.events.length === 0) {
        break;
      }

      allEvents.push(...result.events);
      total = result.totalMatches;
      position += result.events.length;

      if (position >= total || (targetLimit && allEvents.length >= targetLimit)) {
        break;
      }
    }

    return allEvents;
  }
}
