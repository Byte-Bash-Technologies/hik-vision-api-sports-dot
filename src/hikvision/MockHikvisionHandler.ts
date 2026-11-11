import { AcsEventItem, UserInfo } from './types';

/**
 * In-memory Mock ISAPI Handler for offline local development and testing.
 * Accurately simulates the Hikvision ISAPI access controller endpoints.
 */
export class MockHikvisionHandler {
  private users: UserInfo[] = [
    { employeeNo: '1', name: 'Rahul Sharma', userType: 'normal', numOfFP: 1, numOfFace: 1, gender: 'male' },
    { employeeNo: '2', name: 'Priya Patel', userType: 'normal', numOfFP: 1, numOfFace: 1, gender: 'female' },
    { employeeNo: '3', name: 'Amit Singh', userType: 'normal', numOfFP: 1, numOfFace: 0, gender: 'male' },
    { employeeNo: '4', name: 'Sneha Reddy', userType: 'normal', numOfFP: 1, numOfFace: 1, gender: 'female' },
    { employeeNo: '5', name: 'Vikram Verma', userType: 'normal', numOfFP: 0, numOfFace: 1, gender: 'male' },
    { employeeNo: '6', name: 'Ananya Iyer', userType: 'normal', numOfFP: 1, numOfFace: 1, gender: 'female' },
    { employeeNo: '7', name: 'Rohan Mehta', userType: 'normal', numOfFP: 1, numOfFace: 0, gender: 'male' },
    { employeeNo: '8', name: 'Neha Gupta', userType: 'normal', numOfFP: 0, numOfFace: 1, gender: 'female' },
  ];

  private events: AcsEventItem[] = [];

  constructor() {
    this.generateMockEvents();
  }

  private generateMockEvents(): void {
    const now = new Date();
    let serialNo = 1000;

    // Generate 7 days of attendance events for mock members
    for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
      const day = new Date(now.getTime() - dayOffset * 86400000);
      const dateStr = day.toISOString().split('T')[0];

      for (const user of this.users) {
        // Morning shift punch (7:00 AM - 9:30 AM)
        serialNo++;
        const morningHour = 7 + (parseInt(user.employeeNo, 10) % 3);
        const morningMin = (parseInt(user.employeeNo, 10) * 11) % 60;
        const morningTimeStr = `${dateStr}T${String(morningHour).padStart(2, '0')}:${String(morningMin).padStart(2, '0')}:15+05:30`;

        this.events.push({
          major: 5,
          minor: 75, // Access granted
          time: morningTimeStr,
          name: user.name,
          employeeNoString: user.employeeNo,
          cardReaderNo: 1,
          doorNo: 1,
          userType: 'normal',
          currentVerifyMode: user.numOfFace ? 'face' : 'fingerprint',
          serialNo,
          type: 0,
        });

        // Evening shift punch (5:30 PM - 8:00 PM) for even employee numbers
        if (parseInt(user.employeeNo, 10) % 2 === 0) {
          serialNo++;
          const eveHour = 17 + (parseInt(user.employeeNo, 10) % 3);
          const eveMin = (parseInt(user.employeeNo, 10) * 13) % 60;
          const eveTimeStr = `${dateStr}T${String(eveHour).padStart(2, '0')}:${String(eveMin).padStart(2, '0')}:42+05:30`;

          this.events.push({
            major: 5,
            minor: 75, // Access granted
            time: eveTimeStr,
            name: user.name,
            employeeNoString: user.employeeNo,
            cardReaderNo: 1,
            doorNo: 1,
            userType: 'normal',
            currentVerifyMode: 'fingerprint',
            serialNo,
            type: 0,
          });
        }
      }

      // Add a simulated failed punch for Member 5 (expired/invalid time)
      serialNo++;
      this.events.push({
        major: 5,
        minor: 8, // Invalid time / access denied
        time: `${dateStr}T14:22:05+05:30`,
        name: 'Vikram Verma',
        employeeNoString: '5',
        cardReaderNo: 1,
        doorNo: 1,
        userType: 'normal',
        currentVerifyMode: 'face',
        serialNo,
        type: 0,
      });
    }

    // Sort descending by event time
    this.events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }

  public handleRequest(method: string, endpointPath: string, body?: any): any {
    const cleanPath = endpointPath.split('?')[0];

    // 1. Device Info
    if (cleanPath.includes('/ISAPI/System/deviceInfo')) {
      return {
        DeviceInfo: {
          deviceName: 'Mock Hikvision Access Controller',
          deviceID: 'terminal-1',
          model: 'DS-K1T320MFWX',
          serialNumber: 'DS-K1T320MFWX20261109MOCK01',
          macAddress: '00:11:22:33:44:55',
          firmwareVersion: 'V3.2.0_build260101',
          firmwareReleasedDate: '2026-01-01',
          deviceType: 'AccessControlTerminal',
          telecontrolID: '1',
        },
      };
    }

    // 2. System status
    if (cleanPath.includes('/ISAPI/System/status')) {
      return {
        DeviceStatus: {
          currentDeviceTime: new Date().toISOString(),
          deviceMemoryUsage: '34%',
          deviceCpuUsage: '12%',
        },
      };
    }

    // 3. User Count
    if (cleanPath.includes('/ISAPI/AccessControl/UserInfo/Count')) {
      return {
        UserInfoCount: {
          userNumber: this.users.length,
          bindFingerprintUserNumber: this.users.filter((u) => (u.numOfFP || 0) > 0).length,
          bindFaceUserNumber: this.users.filter((u) => (u.numOfFace || 0) > 0).length,
          bindCardUserNumber: this.users.filter((u) => (u.numOfCard || 0) > 0).length,
        },
      };
    }

    // 4. User Search
    if (cleanPath.includes('/ISAPI/AccessControl/UserInfo/Search')) {
      const cond = body?.UserInfoSearchCond || {};
      const pos = Number(cond.searchResultPosition ?? 0);
      const maxResults = Number(cond.maxResults ?? 30);
      const searchID = cond.searchID || '1';
      let filtered = [...this.users];

      if (cond.EmployeeNoList && Array.isArray(cond.EmployeeNoList)) {
        const ids = cond.EmployeeNoList.map((e: any) => String(e.employeeNo));
        filtered = filtered.filter((u) => ids.includes(u.employeeNo));
      }

      const paged = filtered.slice(pos, pos + maxResults);

      return {
        UserInfoSearch: {
          searchID,
          responseStatusStrg: 'OK',
          numOfMatches: paged.length,
          totalMatches: filtered.length,
          UserInfo: paged,
        },
      };
    }

    // 5. User Setup / Create / Update
    if (cleanPath.includes('/ISAPI/AccessControl/UserInfo/SetUp') || cleanPath.includes('/ISAPI/AccessControl/UserInfo/Modify')) {
      const userInfo = body?.UserInfo || {};
      const empNo = String(userInfo.employeeNo || '');
      const existingIdx = this.users.findIndex((u) => u.employeeNo === empNo);
      if (existingIdx >= 0) {
        this.users[existingIdx] = { ...this.users[existingIdx], ...userInfo };
      } else if (empNo) {
        this.users.push(userInfo);
      }
      return {
        ResponseStatus: {
          requestURL: cleanPath,
          statusCode: 1,
          statusString: 'OK',
          subStatusCode: 'ok',
        },
      };
    }

    // 6. User Delete
    if (cleanPath.includes('/ISAPI/AccessControl/UserInfo/RecordDelete')) {
      const cond = body?.UserInfoDelCond || {};
      if (cond.EmployeeNoList && Array.isArray(cond.EmployeeNoList)) {
        const ids = cond.EmployeeNoList.map((e: any) => String(e.employeeNo));
        this.users = this.users.filter((u) => !ids.includes(u.employeeNo));
      }
      return {
        ResponseStatus: {
          requestURL: cleanPath,
          statusCode: 1,
          statusString: 'OK',
          subStatusCode: 'ok',
        },
      };
    }

    // 7. Events Search
    if (cleanPath.includes('/ISAPI/AccessControl/AcsEvent')) {
      const cond = body?.AcsEventCond || {};
      const pos = Number(cond.searchResultPosition ?? 0);
      const maxResults = Number(cond.maxResults ?? 30);
      const searchID = cond.searchID || '1';

      let filtered = [...this.events];

      if (cond.employeeNoString) {
        filtered = filtered.filter((e) => String(e.employeeNoString) === String(cond.employeeNoString));
      }
      if (cond.startTime) {
        const sTime = new Date(cond.startTime).getTime();
        filtered = filtered.filter((e) => new Date(e.time).getTime() >= sTime);
      }
      if (cond.endTime) {
        const eTime = new Date(cond.endTime).getTime();
        filtered = filtered.filter((e) => new Date(e.time).getTime() <= eTime);
      }

      const paged = filtered.slice(pos, pos + maxResults);

      return {
        AcsEvent: {
          searchID,
          responseStatusStrg: 'OK',
          numOfMatches: paged.length,
          totalMatches: filtered.length,
          InfoList: paged,
        },
      };
    }

    // 8. Remote Door Control
    if (cleanPath.includes('/RemoteControl/door')) {
      return {
        ResponseStatus: {
          requestURL: cleanPath,
          statusCode: 1,
          statusString: 'OK',
          subStatusCode: 'ok',
        },
      };
    }

    // 9. Schedule / PlanTemplate
    if (cleanPath.includes('/Schedule/')) {
      return {
        ResponseStatus: {
          requestURL: cleanPath,
          statusCode: 1,
          statusString: 'OK',
          subStatusCode: 'ok',
        },
      };
    }

    // Fallback OK
    return {
      ResponseStatus: {
        requestURL: cleanPath,
        statusCode: 1,
        statusString: 'OK',
        subStatusCode: 'ok',
      },
    };
  }
}

export const mockHikvisionHandler = new MockHikvisionHandler();

