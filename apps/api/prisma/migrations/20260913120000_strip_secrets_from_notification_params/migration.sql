-- Removes confirmation codes from notification rows that already hold one.
--
-- `Notification.params` is returned in full by `GET /notifications` to anyone
-- holding a session for the account. Two call sites stored the six-digit code
-- there alongside sending it by SMS: the password reset, where it turned a
-- session into a password reset, and phone verification, where it defeated
-- the check outright — that code exists to prove control of the *number*, and
-- one readable in-app proves nothing.
--
-- Both call sites have stopped writing it and `NotificationsService.send`
-- now drops these keys whoever asks. This is the rows already written.
--
-- Only the named keys are removed; every other parameter a template renders
-- (amounts, partner names, dates) is left exactly as it was. Rows that never
-- held one are not rewritten at all, which keeps this cheap on a large table.
UPDATE notifications
SET params = params - 'code' - 'otp' - 'pin' - 'token' - 'accessToken'
           - 'refreshToken' - 'password' - 'secret'
WHERE params IS NOT NULL
  AND params ?| array['code', 'otp', 'pin', 'token', 'accessToken', 'refreshToken', 'password', 'secret'];
