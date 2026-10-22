import type { LocaleMessages } from '../types';

const auth: LocaleMessages['auth'] = {
  login: {
    title: 'Sign in',
    subtitle: 'One sign-in for buyers and suppliers',
    username: 'Username or email',
    password: 'Password',
    submit: 'Sign in',
    supplierHint: 'Suppliers sign in with the email address registered for their portal account',
    forgot: 'Forgot password?',
  },
  menu: { changePassword: 'Change password', logout: 'Sign out' },
  changePassword: {
    title: 'Change password',
    oldPassword: 'Current password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    rule: 'At least 8 characters, with both letters and digits',
    mismatch: 'The new passwords do not match',
    success: 'Password changed. Sessions on other devices have been signed out.',
  },
  forgot: {
    title: 'Forgot password',
    subtitle: 'Enter the email address registered for your account and we will send you a reset link',
    email: 'Email',
    submit: 'Send reset email',
    sent: 'If this email address is registered, you will receive a password reset email within a few minutes. The link is valid for 1 hour and can be used only once.',
    backToLogin: 'Back to sign in',
  },
  reset: {
    title: 'Reset password',
    subtitle: 'Set a new password for your account',
    submit: 'Set new password',
    success: 'Your password has been reset. Please sign in with the new password.',
    missingToken: 'The link is incomplete. Open it again from the email, or request a new password reset.',
    requestAgain: 'Request again',
    toLogin: 'Go to sign in',
  },
  activate: {
    title: 'Activate your supplier portal account',
    subtitle: 'Set a password, then sign in to the supplier portal with your email and this password',
    submit: 'Set password and activate',
    success: 'Your account is activated. Please sign in with your email and the new password.',
    missingToken: 'The link is incomplete. Please open it again from the activation email.',
    invalidHint: 'If the link has expired or was already used, please ask your purchasing contact to send a new activation email.',
    toLogin: 'Go to sign in',
  },
};

export default auth;
