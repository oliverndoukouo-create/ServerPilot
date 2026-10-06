export const setupTypes = ['Gaming', 'Esports', 'Creator', 'Community', 'Business', 'Custom'] as const;
export type SetupType = typeof setupTypes[number];

export type SetupCategory = {
  name: string;
  channels: string[];
};

export type SetupVoiceCategory = {
  name: string;
  channels: string[];
};

export type SetupQuestion = {
  id: string;
  label: string;
  feature: string;
};

export type SetupRole = {
  name: string;
  purpose: string;
  color: number;
  permissions: string[];
  permissionsValue: string;
  kind: 'owner' | 'staff' | 'member' | 'vip' | 'bot';
  recommended: boolean;
  explicitlyRequested: boolean;
};

export type SetupAnswers = Record<string, 'yes' | 'no' | 'decide'>;

export type SetupPlan = {
  type: SetupType;
  description: string;
  categories: SetupCategory[];
  voiceCategories: SetupVoiceCategory[];
  recommendedFeatures: string[];
  requestedFeatures: string[];
  skippedFeatures: string[];
  roles: SetupRole[];
  rules: string[];
};

export type SetupRequest = SetupPlan & {
  requestId: string;
  guildId: string;
  userId: string;
  answers: SetupAnswers;
  questions: SetupQuestion[];
  questionIndex: number;
  originalPlan: SetupPlan;
  manualEdits: string[];
  expiresAt: number;
};