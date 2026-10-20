import type { LocaleMessages } from '../types';

const auth: LocaleMessages['auth'] = {
  login: {
    title: 'Sign in',
    subtitle: 'One sign-in for buyers and suppliers',
    username: 'Username or email',
    password: 'Password',
    submit: 'Sign in',
    supplierHint: 'Suppliers sign in with the email address registered for their portal account',
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
};

export default auth;
