// 共享 API 类型定义

export interface User {
  userId: number;
  userName: string;
  identity: string;
  customerTag?: string;
  isAdmin?: boolean;
}

export interface ChatMessage {
  Role: 'User' | 'Assistant' | 'System' | string;
  Content: string;
  ThinkContent?: string;
  CreatedUtc?: string;
  CreatedLocalTime?: string;
  Rating?: 'up' | 'down' | null;
  MsgIndex?: number;
}

export interface RatingResponse {
  chatId: string;
  msgIndex: number;
  rating: 'up' | 'down';
  at: number;
}

export interface AdminStats {
  total: number;
  up: number;
  down: number;
  rate: number;
  recentRatings: Array<{
    chatId: string;
    msgIndex: number;
    rating: 'up' | 'down';
    at: number;
    userName: string;
  }>;
  topDown: Array<{
    chatId: string;
    msgIndex: number;
    content: string;
    userName: string;
    at: number;
  }>;
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
  // ITHub user fields passed through so the UI can show per-user color and
  // online status. Field names mirror the priority pattern above.
  AssignedUser?: {
    UserName?: string;
    Name?: string;
    UserId?: number;
    HtmlColor?: string;
    IsOnline?: boolean;
    Presence?: string;
  };
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