import { HikvisionClient } from './HikvisionClient';

export interface ParsedDeviceInfo {
  deviceName: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  macAddress?: string;
  deviceType?: string;
  raw: unknown;
}

export class HikvisionDevice {
  private cachedDeviceInfo: { data: ParsedDeviceInfo; expiresAt: number } | null = null;
  private static readonly DEVICE_INFO_TTL_MS = 5 * 60 * 1000;

  constructor(private client: HikvisionClient) {}

  public async getDeviceInfo(forceFresh = false): Promise<ParsedDeviceInfo> {
    if (!forceFresh && this.cachedDeviceInfo && Date.now() < this.cachedDeviceInfo.expiresAt) {
      return this.cachedDeviceInfo.data;
    }

    const raw = await this.client.get<any>('/ISAPI/System/deviceInfo?format=json');

    let parsed: ParsedDeviceInfo;
    if (typeof raw === 'string') {
      parsed = this.parseXmlDeviceInfo(raw);
    } else {
      const info = raw.DeviceInfo || raw;
      parsed = {
        deviceName: info.deviceName || 'Access Controller',
        model: info.model || 'DS-K1T320MFWX',
        serialNumber: info.serialNumber || 'Unknown Serial',
        firmwareVersion: info.firmwareVersion
          ? `${info.firmwareVersion} ${info.firmwareReleasedDate || ''}`.trim()
          : 'Unknown Firmware',
        macAddress: info.macAddress,
        deviceType: info.deviceType,
        raw,
      };
    }

    this.cachedDeviceInfo = {
      data: parsed,
      expiresAt: Date.now() + HikvisionDevice.DEVICE_INFO_TTL_MS,
    };
    return parsed;
  }

  private parseXmlDeviceInfo(xml: string): ParsedDeviceInfo {
    const extract = (tag: string): string => {
      const match = new RegExp(`<${tag}>([^<]+)<\/${tag}>`, 'i').exec(xml);
      return match ? match[1].trim() : '';
    };

    return {
      deviceName: extract('deviceName') || 'Access Controller',
      model: extract('model') || 'DS-K1T320MFWX',
      serialNumber: extract('serialNumber') || 'Unknown Serial',
      firmwareVersion: `${extract('firmwareVersion')} ${extract('firmwareReleasedDate')}`.trim() || 'Unknown Firmware',
      macAddress: extract('macAddress') || undefined,
      deviceType: extract('deviceType') || undefined,
      raw: { xml },
    };
  }

  public async testConnection(): Promise<{
    online: boolean;
    latencyMs: number;
    deviceInfo?: ParsedDeviceInfo;
    error?: string;
  }> {
    const startTime = Date.now();
    try {
      const deviceInfo = await this.getDeviceInfo(true);
      return {
        online: true,
        latencyMs: Date.now() - startTime,
        deviceInfo,
      };
    } catch (error: any) {
      return {
        online: false,
        latencyMs: Date.now() - startTime,
        error: error.message || 'Failed to connect to Hikvision terminal',
      };
    }
  }

  /**
   * Remote door open command (Commonly used by React Native gym/office apps)
   */
  public async openDoor(doorNo = 1): Promise<{ success: boolean; message: string }> {
    try {
      const xmlPayload = '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>';
      await this.client.put(
        `/ISAPI/AccessControl/RemoteControl/door/${doorNo}`,
        xmlPayload
      );
      return {
        success: true,
        message: `Door ${doorNo} unlocked successfully`,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || `Failed to unlock door ${doorNo}`,
      };
    }
  }

  /**
    * Get current terminal schedule configuration
   */
  public async getSchedule(): Promise<{
    enabled: boolean;
    mode: 'dual' | 'morning' | 'evening' | '24/7' | 'custom';
    templateNo: number;
    templateName: string;
    morningBeginTime: string;
    morningEndTime: string;
    eveningBeginTime: string;
    eveningEndTime: string;
    beginTime: string;
    endTime: string;
  }> {
    try {
      const tpl = await this.client.get<any>('/ISAPI/AccessControl/UserRightPlanTemplate/2?format=json');
      const week = await this.client.get<any>('/ISAPI/AccessControl/UserRightWeekPlanCfg/2?format=json');
      const tplObj = tpl?.UserRightPlanTemplate;
      const weekList = week?.UserRightWeekPlanCfg?.WeekPlanCfg || [];

      // Find Monday segments as reference
      const mondaySegments = weekList.filter((w: any) => w.week === 'Monday');
      const seg1Obj = mondaySegments.find((s: any) => s.id === 1) || weekList[0];
      const seg2Obj = mondaySegments.find((s: any) => s.id === 2);
      const seg1 = seg1Obj?.TimeSegment;
      const seg2 = seg2Obj?.TimeSegment;

      const hasTwoShifts = Boolean(seg2Obj?.enable && seg2 && seg2.beginTime && seg2.endTime && seg2.beginTime !== '00:00:00');
      const mB = seg1?.beginTime?.slice(0, 5) || '06:00';
      const mE = seg1?.endTime?.slice(0, 5) || '11:00';
      const eB = seg2?.beginTime?.slice(0, 5) || '17:00';
      const eE = seg2?.endTime?.slice(0, 5) || '22:00';

      return {
        enabled: Boolean(tplObj?.enable),
        mode: hasTwoShifts ? 'dual' : mB === '17:00' ? 'evening' : mB === '06:00' ? 'morning' : 'custom',
        templateNo: 2,
        templateName: tplObj?.templateName || 'Two Shifts: Morning (6-11 AM) & Evening (5-10 PM)',
        morningBeginTime: mB,
        morningEndTime: mE,
        eveningBeginTime: eB,
        eveningEndTime: eE,
        beginTime: mB,
        endTime: hasTwoShifts ? eE : mE,
      };
    } catch {
      return {
        enabled: false,
        mode: '24/7',
        templateNo: 1,
        templateName: 'All Day (24/7)',
        morningBeginTime: '06:00',
        morningEndTime: '11:00',
        eveningBeginTime: '17:00',
        eveningEndTime: '22:00',
        beginTime: '00:00',
        endTime: '24:00',
      };
    }
  }

  /**
   * Program terminal hardware time schedule (WeekPlan 2 & PlanTemplate 2)
   * Supports 2 shifts (Morning & Evening) or single custom window
   */
  public async setSchedule(params: {
    enabled: boolean;
    mode?: 'dual' | 'morning' | 'evening' | '24/7' | 'custom';
    templateName?: string;
    morningBeginTime?: string;
    morningEndTime?: string;
    eveningBeginTime?: string;
    eveningEndTime?: string;
    beginTime?: string;
    endTime?: string;
  }): Promise<any> {
    const isDual = params.mode === 'dual' || (Boolean(params.morningBeginTime) && Boolean(params.eveningBeginTime));

    const mB = (params.morningBeginTime || '06:00').slice(0, 5) + ':00';
    const mE = (params.morningEndTime || '11:00').slice(0, 5) + ':00';
    const eB = (params.eveningBeginTime || '17:00').slice(0, 5) + ':00';
    const eE = (params.eveningEndTime || '22:00').slice(0, 5) + ':00';

    const bTime = (params.beginTime || (params.mode === 'morning' ? mB : params.mode === 'evening' ? eB : '06:00')).slice(0, 5) + ':00';
    const eTime = (params.endTime || (params.mode === 'morning' ? mE : params.mode === 'evening' ? eE : '22:00')).slice(0, 5) + ':00';

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const weekPlanCfgList: any[] = [];

    for (const week of days) {
      if (isDual) {
        // Shift 1: Morning
        weekPlanCfgList.push({
          week,
          id: 1,
          enable: params.enabled,
          TimeSegment: {
            beginTime: mB,
            endTime: mE,
          },
        });
        // Shift 2: Evening
        weekPlanCfgList.push({
          week,
          id: 2,
          enable: params.enabled,
          TimeSegment: {
            beginTime: eB,
            endTime: eE,
          },
        });
        // Segments 3 to 8 (must be explicitly provided for Hikvision ISAPI validation)
        for (let s = 3; s <= 8; s++) {
          weekPlanCfgList.push({
            week,
            id: s,
            enable: false,
            TimeSegment: {
              beginTime: '00:00:00',
              endTime: '00:00:00',
            },
          });
        }
      } else {
        weekPlanCfgList.push({
          week,
          id: 1,
          enable: params.enabled,
          TimeSegment: {
            beginTime: bTime,
            endTime: eTime,
          },
        });
        // Segments 2 to 8 (must be explicitly provided for Hikvision ISAPI validation)
        for (let s = 2; s <= 8; s++) {
          weekPlanCfgList.push({
            week,
            id: s,
            enable: false,
            TimeSegment: {
              beginTime: '00:00:00',
              endTime: '00:00:00',
            },
          });
        }
      }
    }

    const weekPlanCfg = {
      UserRightWeekPlanCfg: {
        enable: params.enabled,
        WeekPlanCfg: weekPlanCfgList,
      },
    };

    await this.client.put('/ISAPI/AccessControl/UserRightWeekPlanCfg/2?format=json', weekPlanCfg);

    // Hikvision templateName has a 31-character limit
    const generatedName = isDual
      ? 'Two Shifts'
      : params.enabled
      ? `Shift (${bTime.slice(0, 5)}-${eTime.slice(0, 5)})`
      : 'All Day (24/7)';

    const templateName = (params.templateName || generatedName).slice(0, 30);

    const templateCfg = {
      UserRightPlanTemplate: {
        enable: params.enabled,
        templateName,
        weekPlanNo: 2,
        holidayGroupNo: '',
      },
    };

    return this.client.put('/ISAPI/AccessControl/UserRightPlanTemplate/2?format=json', templateCfg);
  }
}
