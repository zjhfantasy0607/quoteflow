import type { LocaleMessages } from '../types';

const workbench: LocaleMessages['workbench'] = {
  title: 'Workbench',
  subtitle:
    'Hello, {name}. Here is everything that needs your attention now. All times are Beijing Time (UTC+8).',
  refresh: 'Refresh',
  viewAll: 'View all',
  empty: 'Nothing to do',
  noCards: 'There are no to-do items for your account.',
  cards: {
    pendingApproval: 'Awaiting My Approval',
    myDrafts: 'My Drafts / Rejected',
    readyToPublish: 'Ready to Publish',
    waitingQuotes: 'Awaiting Quotes',
    toOpen: 'Ready to Open',
    negotiations: 'Negotiations to Handle',
    contractsToReview: 'Contracts to Review',
    contractsToApprove: 'Contracts to Approve',
  },
  rejected: 'Rejected',
  progress: '{responded}/{invited} responded',
  roundNo: 'Round {n}',
  owner: 'Owner: {name}',
  submittedAt: 'Submitted {time}',
  updatedAt: 'Updated {time}',
  approvedAt: 'Approved {time}',
  deadline: 'Deadline {time}',
  remaining: '{text} left',
  deadlinePassed: 'Deadline passed',
  repliedAt: 'Replied {time}',
  sentAt: 'Sent {time}',
};

export default workbench;
