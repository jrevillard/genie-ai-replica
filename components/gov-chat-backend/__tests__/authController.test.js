// authController.logout: session-service mocked via jest.mock. Pins the A5
// contract: sessions are looked up by the authenticated identity (req.user.iss_sub,
// activeOnly), each session is ended, session errors are swallowed (logout still
// succeeds), and the failure path answers the standard {error, message, details} shape.
jest.mock('../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn()
}));

const authController = require('../controllers/authController');
const sessionService = require('../services/session-service');

const REQ = () => ({
  user: {
    iss_sub: 'http://localhost:8080/realms/genie#user-123',
    _key: 'users/123',
    iss: 'http://localhost:8080/realms/genie'
  }
});

function makeRes() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

describe('authController.logout', () => {
  beforeEach(() => {
    sessionService.getUserSessions.mockReset();
    sessionService.endSession.mockReset();
  });

  it('ends every active session looked up by req.user.iss_sub', async () => {
    sessionService.getUserSessions.mockResolvedValue([{ _key: 's1' }, { _key: 's2' }]);
    const req = REQ();
    const res = makeRes();

    await authController.logout(req, res);

    expect(sessionService.getUserSessions).toHaveBeenCalledWith(req.user.iss_sub, true);
    expect(sessionService.endSession).toHaveBeenCalledTimes(2);
    expect(sessionService.endSession).toHaveBeenCalledWith('s1');
    expect(sessionService.endSession).toHaveBeenCalledWith('s2');
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Logged out successfully' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('session lookup failure is swallowed — logout still returns success', async () => {
    sessionService.getUserSessions.mockRejectedValue(new Error('arango down'));
    const res = makeRes();

    await authController.logout(REQ(), res);

    expect(sessionService.endSession).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Logged out successfully' });
  });

  it('outer failure answers the standard error shape (no legacy {success:false})', async () => {
    // Force the outer catch: first res.json (the success write) throws once,
    // the catch block's error write goes through normally.
    const res = makeRes();
    res.json.mockImplementationOnce(() => {
      throw new Error('socket destroyed');
    });
    sessionService.getUserSessions.mockResolvedValue([]);

    await authController.logout(REQ(), res);

    // second res.json call comes from the catch block
    expect(res.json).toHaveBeenLastCalledWith({ error: 'INTERNAL_ERROR', message: 'Logout failed', details: {} });
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
