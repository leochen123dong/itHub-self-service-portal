// 共享 API 类型定义

export interface User {
  userId: number;
  userName: string;
  identity: string;
  customerTag?: string;
}

export interface ChatMessage {
  Role: 'User' | 'Assistant' | 'System' | string;
  Content: string;
  ThinkContent?: string;
  CreatedUtc?: string;
  CreatedLocalTime?: string;
}

export interface ChatInitResponse {
  AIChatId: string;
  ChatTitle?: string;
  Messages?: ChatMessage[];
}

export interface ChatMessageResponse {
  Messages?: ChatMessage[];
  SuggestedActions?: SuggestedAction[];
}

export interface SuggestedAction {
  Text: string;
}

export interface AIProfile {
  AIProfileId: number;
  Name: string;
  Tag: string;
  Description?: string;
  Active?: boolean;
}

export interface KnowledgeArticle {
  KnowledgeArticleId: number;
  Name?: string;
  Title?: string;
  Description?: string;
  Content?: string;
  Body?: string;
  Summary?: string;
  KnowledgeCategoryId?: number;
}

export interface TicketTemplate {
  TicketTemplateId: number;
  Name?: string;
  Description?: string;
  Tag?: string;
  Summary?: string;
  Active?: boolean;
}

export interface TicketTemplateMenu {
  MenuItems?: any[];
  Categories?: any[];
  [k: string]: any;
}

export interface TicketTemplateConfig {
  TicketPropertyDefinitions?: any[];
  UserInputFormConfig?: any;
  [k: string]: any;
}

export interface Ticket {
  TicketId: number;
  Summary?: string;
  Category?: string;
  TicketState?: string;
  TicketStatus?: string | number;
  Priority?: number;
  PriorityHtmlColor?: string;
  CreatedUtc?: string;
  CreatedLocalTime?: string;
  CustomerName?: string;
  AssignedUserGroup?: { Name?: string; UserGroupId?: number };
  AssignedUser?: { UserName?: string; UserId?: number };
  IncidentState?: string | number;
  TicketCategory?: { Name?: string };
  TicketDetail?: any;
}

export interface TicketJournal {
  TicketJournalId?: number;
  TicketJournalType?: string | number;
  Content?: string;
  CreatedUtc?: string;
  CreatedLocalTime?: string;
  UserName?: string;
}

export interface ApiError {
  error: { code: string; message_zh: string };
}