export interface HikvisionConfig {
  host: string;
  username: string;
  password?: string;
  verifyTls?: boolean;
  timeoutMs?: number;
  isMock?: boolean;
}

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
  domain?: string;
  stale?: boolean;
}

export interface DeviceInfoResponse {
  DeviceInfo?: {
    deviceName?: string;
    deviceID?: string;
    model?: string;
    serialNumber?: string;
    macAddress?: string;
    firmwareVersion?: string;
    firmwareReleasedDate?: string;
    deviceType?: string;
    telecontrolID?: string;
  };
  [key: string]: unknown;
}

export interface UserCountResponse {
  userNumber?: number;
  bindFingerprintUserNumber?: number;
  bindFaceUserNumber?: number;
  bindCardUserNumber?: number;
  [key: string]: unknown;
}

export interface UserInfo {
  employeeNo: string;
  name: string;
  userType: string;
  numOfCard?: number;
  numOfFP?: number;
  numOfFace?: number;
  gender?: string;
  groupId?: number;
  userVerifyMode?: string;
  [key: string]: unknown;
}

export interface UserInfoSearchResponse {
  UserInfoSearch?: {
    searchID?: string;
    responseStatusStrg?: string;
    numOfMatches?: number;
    totalMatches?: number;
    UserInfo?: UserInfo[];
  };
  [key: string]: unknown;
}

export interface AcsEventItem {
  major: number;
  minor: number;
  time: string;
  name?: string;
  employeeNoString?: string;
  cardType?: number;
  cardReaderNo?: number;
  doorNo?: number;
  userType?: string;
  currentVerifyMode?: string;
  serialNo?: number;
  type?: number;
  [key: string]: unknown;
}

export interface AcsEventSearchResponse {
  AcsEvent?: {
    searchID?: string;
    responseStatusStrg?: string;
    numOfMatches?: number;
    totalMatches?: number;
    InfoList?: AcsEventItem[];
  };
  [key: string]: unknown;
}

export class HikvisionError extends Error {
  public readonly statusCode?: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code: string, statusCode?: number, details?: unknown) {
    super(message);
    this.name = 'HikvisionError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, HikvisionError.prototype);
  }
}
