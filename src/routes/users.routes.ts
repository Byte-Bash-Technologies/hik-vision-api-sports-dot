import { Router, Request, Response, NextFunction } from 'express';
import { HikvisionClient, HikvisionUsers } from '../hikvision';
import { config } from '../config';
import { scanEnforcerService } from '../services/scanEnforcer.service';

const router = Router();

const client = new HikvisionClient({
  host: config.HIKVISION_HOST,
  username: config.HIKVISION_USERNAME,
  password: config.HIKVISION_PASSWORD,
  verifyTls: config.HIKVISION_VERIFY_TLS,
  timeoutMs: config.HIKVISION_TIMEOUT,
});

const usersService = new HikvisionUsers(client);

/**
 * Helper to map Hikvision UserInfo to standard HikUser format
 */
function formatHikUser(u: any) {
  const isEnabled = u.userType !== 'blackList' && (u.Valid ? u.Valid.enable !== false : true);
  return {
    id: u.employeeNo,
    employeeNo: u.employeeNo,
    name: u.name || 'Unnamed',
    userType: u.userType || 'normal',
    enabled: isEnabled,
    gender: u.gender || null,
    groupId: u.groupId ? Number(u.groupId) : 1,
    numOfFP: Number(u.numOfFP ?? 0),
    numOfFace: Number(u.numOfFace ?? 0),
    numOfCard: Number(u.numOfCard ?? 0),
    validFrom: u.Valid?.beginTime || null,
    validTo: u.Valid?.endTime || null,
    terminalSyncStatus: 'SYNCED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * GET /api/users
 * Returns list of users matching React Native HikUser interface
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const position = req.query.position ? parseInt(req.query.position as string, 10) : 0;
    const maxResults = req.query.maxResults ? parseInt(req.query.maxResults as string, 10) : 30;
    const employeeNo = req.query.employeeNo as string | undefined;

    const result = await usersService.searchUsers({
      position,
      maxResults,
      employeeNo,
    });

    const formattedUsers = result.users.map(formatHikUser);

    res.json({
      success: true,
      data: formattedUsers,
      pagination: {
        page: Math.floor(position / maxResults) + 1,
        limit: maxResults,
        total: result.totalMatches,
        totalPages: Math.ceil(result.totalMatches / maxResults) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users
 * Create or register a new user on the terminal
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeNo, name, userType, validFrom, validTo, enabled, gender, doorNo, planTemplateNo } = req.body;

    if (!employeeNo || !name) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'employeeNo and name are required' },
      });
      return;
    }

    await usersService.setUpUser({
      employeeNo,
      name,
      userType,
      validFrom,
      validTo,
      enabled: enabled !== false,
      gender,
      doorNo: doorNo || 1,
      planTemplateNo,
    });

    // Grant enrollment test credit so reception verification scan does not consume daily checkin
    scanEnforcerService.grantEnrollmentCredit(String(employeeNo));

    res.status(201).json({
      success: true,
      message: `User ${name} (${employeeNo}) registered on terminal successfully`,
      data: {
        employeeNo,
        name,
        enabled: enabled !== false,
        validFrom,
        validTo,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users/sync
 * Sync users endpoint called by React Native app
 */
router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  try {
    const allUsers = await usersService.fetchAllUsers(30);
    res.json({
      success: true,
      data: {
        count: allUsers.length,
        durationMs: Date.now() - start,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/users/count
 * Biometric enrollment counts
 */
router.get('/count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const counts = await usersService.getUserCount();
    res.json({
      success: true,
      data: counts,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/users/next-id
 * Computes next orderly sequential ID for terminal enrollment
 */
router.get('/next-id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allUsers = await usersService.fetchAllUsers(100);
    const existingIds = new Set(allUsers.map((u) => String(u.employeeNo)));
    let nextId = 1;
    while (existingIds.has(String(nextId))) {
      nextId++;
    }
    res.json({
      success: true,
      data: { nextId: String(nextId), totalEnrolled: allUsers.length },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/users/:employeeNo
 * Single user details
 */
router.get('/:employeeNo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await usersService.searchUsers({
      employeeNo: req.params.employeeNo,
      maxResults: 1,
    });

    if (!result.users || result.users.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `User with employeeNo '${req.params.employeeNo}' not found on terminal`,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: formatHikUser(result.users[0]),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/users/:employeeNo/status
 * Enable or disable terminal door access for a member
 */
router.patch('/:employeeNo/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { enabled } = req.body;
    const employeeNo = req.params.employeeNo;

    if (enabled === undefined) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Field enabled (boolean) is required' },
      });
      return;
    }

    await usersService.updateUserStatus(employeeNo, Boolean(enabled));

    res.json({
      success: true,
      message: `Access for user ${employeeNo} has been ${enabled ? 'enabled' : 'blocked'}`,
      data: { employeeNo, enabled: Boolean(enabled) },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users/:employeeNo/expire
 * Immediately expire/block a user on the terminal
 */
router.post('/:employeeNo/expire', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNo = req.params.employeeNo;
    await usersService.updateUserStatus(employeeNo, false);

    res.json({
      success: true,
      message: `Terminal access for user ${employeeNo} has been expired/blocked`,
      data: { employeeNo, enabled: false },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users/:employeeNo/grant
 * Grant/extend validity by N years (default 1)
 */
router.post('/:employeeNo/grant', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNo = req.params.employeeNo;
    const months = req.body?.months ? Number(req.body.months) : (req.body?.years ? Number(req.body.years) * 12 : 1);
    const days = req.body?.days ? Number(req.body.days) : Math.round(months * 30);

    const validFrom = new Date().toISOString().slice(0, 19);
    const validTo = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 19);

    await usersService.updateAccessPeriod(employeeNo, validFrom, validTo, true);
    scanEnforcerService.grantEnrollmentCredit(String(employeeNo));

    res.json({
      success: true,
      message: `Access granted for ${days} days (~${months} month(s)) to user ${employeeNo}`,
      data: { employeeNo, validFrom, validTo, enabled: true },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users/:employeeNo/access-period
 * Set custom access period (synced from gym membership dates)
 */
router.post('/:employeeNo/access-period', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNo = req.params.employeeNo;
    const { validFrom, validTo, enabled } = req.body;

    if (!validFrom || !validTo) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'validFrom and validTo dates are required' },
      });
      return;
    }

    await usersService.updateAccessPeriod(
      employeeNo,
      validFrom,
      validTo,
      enabled !== false
    );
    scanEnforcerService.grantEnrollmentCredit(String(employeeNo));

    res.json({
      success: true,
      message: `Membership validity period updated on terminal for user ${employeeNo}`,
      data: {
        employeeNo,
        validFrom,
        validTo,
        enabled: enabled !== false,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users/:employeeNo/unlock
 * Immediately resets a user's beginTime to today and gives them a 2-hour exemption
 * Useful when a member is locked out by 1-scan-per-day or needs test entry
 */
router.post('/:employeeNo/unlock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNo = req.params.employeeNo;
    const ok = await scanEnforcerService.resetUserToToday(employeeNo);
    if (!ok) {
      res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: `User ${employeeNo} not found` },
      });
      return;
    }

    res.json({
      success: true,
      message: `User ${employeeNo} unlocked for today and exempted for 2 hours`,
      data: { employeeNo, unlocked: true },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users/:employeeNo/fingerprint/capture
 * Interactive Fingerprint Capture & Save
 * Triggers physical terminal sensor to capture finger and saves template to employee profile
 */
router.post('/:employeeNo/fingerprint/capture', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNo = req.params.employeeNo;
    const fingerPrintID = req.body?.fingerPrintID ? Number(req.body.fingerPrintID) : 1;

    const result = await usersService.captureAndSaveFingerprint(employeeNo, fingerPrintID);
    scanEnforcerService.grantEnrollmentCredit(String(employeeNo));

    res.json({
      success: true,
      message: `Fingerprint ${fingerPrintID} captured and saved for employee ${employeeNo}`,
      data: {
        employeeNo,
        fingerPrintID,
        quality: result.quality,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/users/:employeeNo/fingerprint
 * Query enrolled fingerprints for an employee
 */
router.get('/:employeeNo/fingerprint', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNo = req.params.employeeNo;
    const list = await usersService.getUserFingerprints(employeeNo);

    res.json({
      success: true,
      data: list,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/users/:employeeNo/fingerprint/:id
 * Delete a specific fingerprint for an employee
 */
router.delete('/:employeeNo/fingerprint/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNo = req.params.employeeNo;
    const fingerPrintID = parseInt(req.params.id, 10) || 1;

    await usersService.deleteUserFingerprint(employeeNo, fingerPrintID);

    res.json({
      success: true,
      message: `Fingerprint ${fingerPrintID} deleted for user ${employeeNo}`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/users/:employeeNo
 * Delete employee and all biometrics from terminal
 */
router.delete('/:employeeNo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employeeNo = req.params.employeeNo;
    await usersService.deleteUser(employeeNo);

    res.json({
      success: true,
      message: `User ${employeeNo} deleted from terminal`,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
