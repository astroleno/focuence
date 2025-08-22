// 标签页信息
export interface TabInfo {
  id: number;
  title: string;
  url: string;
  windowId: number;
  domain: string;
  path: string;
  attentionScore: number;
  createTime: number;
  lastAccessTime: number;
  activeTime: number;
  visitCount: number;
  totalDwellTime: number;
  switchSequence?: number[];
  interactionEvents?: InteractionEvent[];
}

// 用户交互事件
export interface InteractionEvent {
  type: 'activate' | 'deactivate' | 'switch_from' | 'switch_to';
  timestamp: number;
  fromTabId?: number;
  toTabId?: number;
  duration?: number;
}

// AI分组结果
export interface GroupResult {
  groups: TabGroup[];
  ungrouped: number[];
  actions: {
    reuse: { name: string; tabIds: number[] }[];
    rename: { from: string; to: string; reason: string }[];
    merge: { into: string; from: string[]; reason: string }[];
  };
  insights: string;
}

// 标签页分组
export interface TabGroup {
  id: string;
  name: string;
  description: string;
  tabIds: number[];
  confidence: number;
  reasoning: string;
  createdAt: number;
  aiGenerated: boolean;
  attentionWeight: number;
}

// 注意力知识图谱节点
export interface AttentionNode {
  tabId: number;
  weight: number;
  connections: AttentionEdge[];
  temporalDecay: number;
  contextualRelevance: number;
}

// 注意力图谱边
export interface AttentionEdge {
  fromTabId: number;
  toTabId: number;
  strength: number;
  lastInteraction: number;
  interactionCount: number;
  contextType: 'sequential' | 'comparative' | 'referential' | 'workflow';
}

// 工作会话
export interface WorkSession {
  id: string;
  startTime: number;
  endTime: number;
  tabSequence: number[];
  primaryFocus: number[];
  sessionType: 'development' | 'research' | 'design' | 'general';
  productivity: number;
}

// 设置配置
export interface Settings {
  ai: {
    enabled: boolean;
    provider: 'openai' | 'anthropic' | 'deepseek' | 'custom';
    model: string;
    customModel?: string;
    apiKey: string;
    apiUrl: string;
    temperature: number;
    maxTokens: number;
  };
  attention: {
    trackingEnabled: boolean;
    sessionTimeout: number;
    decayRate: number;
    minScore: number;
  };
  grouping: {
    autoGrouping: boolean;
    minGroupSize: number;
    maxGroupSize: number;
    confidenceThreshold: number;
  };
  ui: {
    theme: 'light' | 'dark' | 'auto';
    compactMode: boolean;
    showScores: boolean;
  };
}

// 工作区定义
export interface Workspace {
  id: string;
  name: string;
  description: string;
  groups: TabGroup[];
  createdAt: number;
  updatedAt: number;
  isTemplate: boolean;
  tags: string[];
  metadata: {
    totalTabs: number;
    avgAttentionScore: number;
    workflowType: string;
  };
}

// Chrome消息类型
export interface ChromeMessage {
  type: 'GET_TABS' | 'PERFORM_GROUPING' | 'UPDATE_ATTENTION' | 'GET_GROUPS' | 'APPLY_GROUPS' | 'UPDATE_GROUP' | 'DELETE_GROUP' | 'SAVE_WORKSPACE' | 'LOAD_WORKSPACE' | 'GET_WORKSPACES' | 'DELETE_WORKSPACE';
  payload?: any;
}