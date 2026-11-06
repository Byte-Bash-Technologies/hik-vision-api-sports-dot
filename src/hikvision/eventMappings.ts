export interface EventCodeDefinition {
  major: number;
  minor: number;
  category: string;
  description: string;
  verified: boolean;
}

export const KNOWN_EVENT_CODES: Record<string, EventCodeDefinition> = {
  '5:38': {
    major: 5,
    minor: 38,
    category: 'Access Control',
    description: 'Authentication Passed / Access Granted',
    verified: true,
  },
  '5:39': {
    major: 5,
    minor: 39,
    category: 'Access Control',
    description: 'Authentication Failed / Access Denied',
    verified: true,
  },
  '5:21': {
    major: 5,
    minor: 21,
    category: 'Access Control',
    description: 'Door Unlocked',
    verified: true,
  },
  '5:22': {
    major: 5,
    minor: 22,
    category: 'Access Control',
    description: 'Door Locked',
    verified: true,
  },
  '5:1': {
    major: 5,
    minor: 1,
    category: 'Access Control',
    description: 'Door Unlocked',
    verified: true,
  },
  '5:2': {
    major: 5,
    minor: 2,
    category: 'Access Control',
    description: 'Door Locked',
    verified: true,
  },
  '5:6': {
    major: 5,
    minor: 6,
    category: 'Access Control',
    description: 'Blacklist Access Denied',
    verified: true,
  },
  '5:7': {
    major: 5,
    minor: 7,
    category: 'Access Control',
    description: 'Fingerprint Not Found / Verification Failed',
    verified: true,
  },
  '5:8': {
    major: 5,
    minor: 8,
    category: 'Access Control',
    description: 'Access Denied - Invalid Time / Not in Validity Period',
    verified: true,
  },
  '5:9': {
    major: 5,
    minor: 9,
    category: 'Access Control',
    description: 'Access Denied - Membership Expired',
    verified: true,
  },
  '5:75': {
    major: 5,
    minor: 75,
    category: 'Access Control',
    description: 'Face Verification Passed',
    verified: true,
  },
  '5:76': {
    major: 5,
    minor: 76,
    category: 'Access Control',
    description: 'Face Verification Failed',
    verified: true,
  },
  '5:104': {
    major: 5,
    minor: 104,
    category: 'Access Control',
    description: 'Authentication Passed / Access Granted',
    verified: true,
  },
  '3:1024': {
    major: 3,
    minor: 1024,
    category: 'System / Remote',
    description: 'Remote Door Open via ISAPI/App',
    verified: true,
  },
  '3:112': {
    major: 3,
    minor: 112,
    category: 'System / Security',
    description: 'Remote Host Login / Web Session',
    verified: true,
  },
  '3:80': {
    major: 3,
    minor: 80,
    category: 'System / Configuration',
    description: 'Terminal Configuration Updated',
    verified: true,
  },
  '2:1024': {
    major: 2,
    minor: 1024,
    category: 'System / Power',
    description: 'Terminal Startup / Reboot',
    verified: true,
  },
  '1:1028': {
    major: 1,
    minor: 1028,
    category: 'Network',
    description: 'Network Connected',
    verified: true,
  },
  '1:1029': {
    major: 1,
    minor: 1029,
    category: 'Network',
    description: 'Network Disconnected',
    verified: true,
  },
};

export function getNeutralEventDescription(major: number, minor: number, verifyMode?: string): {
  category: string;
  description: string;
  verifyModeLabel: string;
  codeDisplay: string;
} {
  const key = `${major}:${minor}`;
  const known = KNOWN_EVENT_CODES[key];

  const category = known ? known.category : major === 5 ? 'Access Control' : `Major ${major}`;
  const description = known ? known.description : `Raw Event (Major: ${major}, Minor: ${minor})`;

  const verifyModeMap: Record<string, string> = {
    faceOrFpOrCardOrPw: 'Face / Fingerprint / Card / Password',
    fp: 'Fingerprint',
    face: 'Face',
    card: 'Card',
    pw: 'Password',
    faceAndFp: 'Face + Fingerprint',
    cardAndFp: 'Card + Fingerprint',
    invalid: 'System / Device',
  };

  const verifyModeLabel = verifyMode ? verifyModeMap[verifyMode] || verifyMode : 'Unspecified';

  return {
    category,
    description,
    verifyModeLabel,
    codeDisplay: `[${major}, ${minor}]`,
  };
}
