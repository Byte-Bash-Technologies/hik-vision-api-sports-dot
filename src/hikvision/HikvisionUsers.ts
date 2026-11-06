import { HikvisionClient } from './HikvisionClient';
import { UserInfo, UserInfoSearchResponse } from './types';

export interface UserCountResult {
  userNumber: number;
  bindFingerprintUserNumber: number;
  bindFaceUserNumber: number;
  bindCardUserNumber: number;
  raw: unknown;
}

export interface SearchUsersOptions {
  position?: number;
  maxResults?: number;
  employeeNo?: string;
  searchId?: string;
}

export interface UserSearchResult {
  searchId: string;
  totalMatches: number;
  numOfMatches: number;
  users: UserInfo[];
  raw: unknown;
}

export interface SetUpUserParams {
  employeeNo: string;
  name: string;
  userType?: string;
  validFrom?: string;
  validTo?: string;
  enabled?: boolean;
  gender?: string;
  doorNo?: number;
  planTemplateNo?: string | number;
}

export interface EnrolledFingerprint {
  cardReaderNo: number;
  fingerPrintID: number;
  fingerType: string;
  fingerData?: string;
}

export class HikvisionUsers {
  constructor(private client: HikvisionClient) {}

  public async getUserCount(): Promise<UserCountResult> {
    const raw = await this.client.get<any>('/ISAPI/AccessControl/UserInfo/Count?format=json');
    const data = raw.UserInfoCount || raw;

    return {
      userNumber: Number(data.userNumber ?? 0),
      bindFingerprintUserNumber: Number(data.bindFingerprintUserNumber ?? 0),
      bindFaceUserNumber: Number(data.bindFaceUserNumber ?? 0),
      bindCardUserNumber: Number(data.bindCardUserNumber ?? 0),
      raw,
    };
  }

  public async searchUsers(options: SearchUsersOptions = {}): Promise<UserSearchResult> {
    const position = options.position ?? 0;
    const maxResults = options.maxResults ?? 30;
    const searchId = options.searchId || '1';

    const searchCond: Record<string, any> = {
      searchID: searchId,
      searchResultPosition: position,
      maxResults: maxResults,
    };

    if (options.employeeNo) {
      searchCond.EmployeeNoList = [{ employeeNo: String(options.employeeNo) }];
    }

    const payload = {
      UserInfoSearchCond: searchCond,
    };

    const raw = await this.client.post<UserInfoSearchResponse>(
      '/ISAPI/AccessControl/UserInfo/Search?format=json',
      payload
    );

    const search = raw.UserInfoSearch || {};
    const users = Array.isArray(search.UserInfo) ? search.UserInfo : [];
    const totalMatches = Number(search.totalMatches ?? users.length);
    const numOfMatches = Number(search.numOfMatches ?? users.length);

    return {
      searchId: search.searchID || searchId,
      totalMatches,
      numOfMatches,
      users,
      raw,
    };
  }

  public async fetchAllUsers(batchSize = 30): Promise<UserInfo[]> {
    const allUsers: UserInfo[] = [];
    let position = 0;
    let total = Infinity;

    while (position < total) {
      const result = await this.searchUsers({
        position,
        maxResults: batchSize,
      });

      if (!result.users || result.users.length === 0) {
        break;
      }

      allUsers.push(...result.users);
      total = result.totalMatches;
      position += result.users.length;

      if (position >= total) {
        break;
      }
    }

    return allUsers;
  }

  /**
   * Create or update user on terminal with access validity window
   */
  public async setUpUser(params: SetUpUserParams): Promise<any> {
    const beginTime = params.validFrom
      ? params.validFrom.replace(/\.\d+Z$/, '').replace(/Z$/, '')
      : new Date().toISOString().slice(0, 19);

    // Default 1 month (30 days) from now if not specified
    const defaultEndTime = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 19);
    const endTime = params.validTo
      ? params.validTo.replace(/\.\d+Z$/, '').replace(/Z$/, '')
      : defaultEndTime;

    const isEnabled = params.enabled !== false;

    const payload = {
      UserInfo: {
        employeeNo: String(params.employeeNo),
        name: params.name,
        userType: isEnabled ? (params.userType || 'normal') : 'blackList',
        Valid: {
          enable: isEnabled,
          beginTime,
          endTime,
          timeType: 'local',
        },
        doorRight: '1',
        RightPlan: [
          {
            doorNo: params.doorNo || 1,
            planTemplateNo: String(params.planTemplateNo || '2'),
          },
        ],
        gender: params.gender || 'male',
        groupId: 1,
      },
    };

    return this.client.put('/ISAPI/AccessControl/UserInfo/SetUp?format=json', payload);
  }

  /**
   * Enable or disable door entry for a user
   * When blocked, sets userType to 'blackList' which strictly denies entry on terminal hardware
   */
  public async updateUserStatus(employeeNo: string, enabled: boolean): Promise<any> {
    const res = await this.searchUsers({ employeeNo, maxResults: 1 });
    if (!res.users || res.users.length === 0) {
      throw new Error(`User ${employeeNo} not found on terminal`);
    }

    const user = res.users[0];
    const valid: any = {
      beginTime: new Date().toISOString().slice(0, 19),
      endTime: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 19),
      timeType: 'local',
      ...(user.Valid || {}),
      enable: enabled,
    };

    const payload = {
      UserInfo: {
        employeeNo: String(user.employeeNo),
        name: user.name,
        userType: enabled ? 'normal' : 'blackList',
        Valid: valid,
        doorRight: user.doorRight || '1',
        RightPlan: user.RightPlan || [
          {
            doorNo: 1,
            planTemplateNo: '1',
          },
        ],
        gender: user.gender || 'male',
        groupId: user.groupId || 1,
      },
    };

    return this.client.put('/ISAPI/AccessControl/UserInfo/SetUp?format=json', payload);
  }

  /**
   * Set user access validity window (e.g. synced from gym membership expiration)
   */
  public async updateAccessPeriod(
    employeeNo: string,
    validFrom: string,
    validTo: string,
    enabled = true
  ): Promise<any> {
    const res = await this.searchUsers({ employeeNo, maxResults: 1 });
    if (!res.users || res.users.length === 0) {
      throw new Error(`User ${employeeNo} not found on terminal`);
    }

    const user = res.users[0];
    const cleanFrom = validFrom.replace(/\.\d+Z$/, '').replace(/Z$/, '');
    const cleanTo = validTo.replace(/\.\d+Z$/, '').replace(/Z$/, '');

    const payload = {
      UserInfo: {
        employeeNo: String(user.employeeNo),
        name: user.name,
        userType: enabled ? 'normal' : 'blackList',
        Valid: {
          enable: enabled,
          beginTime: cleanFrom,
          endTime: cleanTo,
          timeType: 'local',
        },
        doorRight: user.doorRight || '1',
        RightPlan: user.RightPlan || [{ doorNo: 1, planTemplateNo: '1' }],
        gender: user.gender || 'male',
        groupId: user.groupId || 1,
      },
    };

    return this.client.put('/ISAPI/AccessControl/UserInfo/SetUp?format=json', payload);
  }

  /**
   * Assign access time plan template (e.g. '1' for All-Day 24/7, '2' for Evening 5-10PM)
   */
  public async updateUserPlanTemplate(employeeNo: string, planTemplateNo: string): Promise<any> {
    const res = await this.searchUsers({ employeeNo, maxResults: 1 });
    if (!res.users || res.users.length === 0) {
      throw new Error(`User ${employeeNo} not found on terminal`);
    }

    const user = res.users[0];
    const payload = {
      UserInfo: {
        employeeNo: String(user.employeeNo),
        name: user.name,
        userType: user.userType || 'normal',
        Valid: user.Valid || {
          enable: true,
          beginTime: new Date().toISOString().slice(0, 19),
          endTime: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 19),
          timeType: 'local',
        },
        doorRight: user.doorRight || '1',
        RightPlan: [
          {
            doorNo: 1,
            planTemplateNo: String(planTemplateNo),
          },
        ],
        gender: user.gender || 'male',
        groupId: user.groupId || 1,
      },
    };

    return this.client.put('/ISAPI/AccessControl/UserInfo/SetUp?format=json', payload);
  }

  /**
   * Delete user from terminal
   */
  public async deleteUser(employeeNo: string): Promise<any> {
    const payload = {
      UserInfoDelCond: {
        EmployeeNoList: [{ employeeNo: String(employeeNo) }],
      },
    };
    return this.client.put('/ISAPI/AccessControl/UserInfo/Delete?format=json', payload);
  }

  /**
   * Trigger terminal hardware sensor to capture a fingerprint touch
   * The terminal beeps and prompts "Please press finger".
   */
  public async captureFingerprint(fingerNo = 1): Promise<{
    fingerData: string;
    quality: number;
    fingerNo: number;
  }> {
    const xmlCond = `<CaptureFingerPrintCond version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><fingerNo>${fingerNo}</fingerNo></CaptureFingerPrintCond>`;
    const response = await this.client.post<string>(
      '/ISAPI/AccessControl/CaptureFingerPrint',
      xmlCond
    );

    const dataMatch = /<fingerData>([^<]+)<\/fingerData>/i.exec(String(response));
    const qualityMatch = /<fingerPrintQuality>([^<]+)<\/fingerPrintQuality>/i.exec(String(response));

    if (!dataMatch || !dataMatch[1]) {
      throw new Error('No fingerprint detected. Please place finger firmly on the sensor when prompted.');
    }

    return {
      fingerData: dataMatch[1].trim(),
      quality: qualityMatch ? parseInt(qualityMatch[1].trim(), 10) : 80,
      fingerNo,
    };
  }

  /**
   * Bind captured fingerprint data to an employee
   */
  public async saveFingerprint(
    employeeNo: string,
    fingerData: string,
    fingerPrintID = 1
  ): Promise<any> {
    const payload = {
      FingerPrintCfg: {
        employeeNo: String(employeeNo),
        enableCardReader: [1],
        fingerPrintID,
        fingerType: 'normalFP',
        fingerData,
      },
    };

    try {
      return await this.client.post('/ISAPI/AccessControl/FingerPrintDownload?format=json', payload);
    } catch {
      return await this.client.post('/ISAPI/AccessControl/FingerPrint/SetUp?format=json', payload);
    }
  }

  /**
   * Interactive capture & save in one flow
   */
  public async captureAndSaveFingerprint(
    employeeNo: string,
    fingerPrintID = 1
  ): Promise<{ success: boolean; message: string; quality: number; fingerPrintID: number }> {
    const captured = await this.captureFingerprint(fingerPrintID);
    await this.saveFingerprint(employeeNo, captured.fingerData, fingerPrintID);

    return {
      success: true,
      message: 'Fingerprint enrolled and saved successfully',
      quality: captured.quality,
      fingerPrintID,
    };
  }

  /**
   * Get enrolled fingerprints for an employee
   */
  public async getUserFingerprints(employeeNo: string): Promise<EnrolledFingerprint[]> {
    try {
      const payload = {
        FingerPrintCond: {
          searchID: '1',
          employeeNo: String(employeeNo),
        },
      };

      const res = await this.client.post<any>(
        '/ISAPI/AccessControl/FingerPrintUpload?format=json',
        payload
      );

      const list = res?.FingerPrintInfo?.FingerPrintList || [];
      return Array.isArray(list) ? list : [list];
    } catch {
      return [];
    }
  }

  /**
   * Delete a fingerprint for an employee
   */
  public async deleteUserFingerprint(employeeNo: string, fingerPrintID = 1): Promise<any> {
    const payload = {
      FingerPrintDelete: {
        mode: 'byEmployeeNo',
        EmployeeNoDetail: {
          employeeNo: String(employeeNo),
          enableCardReader: [1],
          fingerPrintID: [fingerPrintID],
        },
      },
    };

    return this.client.put('/ISAPI/AccessControl/FingerPrint/Delete?format=json', payload);
  }
}
