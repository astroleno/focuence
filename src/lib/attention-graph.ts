import { TabInfo, AttentionNode, AttentionEdge, WorkSession, InteractionEvent } from '../types';

/**
 * 注意力知识图谱引擎
 * 基于用户行为模式构建标签页关系网络，实现智能工作区识别
 */
export class AttentionGraph {
  private nodes: Map<number, AttentionNode> = new Map();
  private currentSession: WorkSession | null = null;
  private sessionTimeout = 30 * 60 * 1000; // 30分钟会话超时
  private decayRate = 0.98; // 每小时衰减2%

  constructor() {
    this.startNewSession();
  }

  /**
   * 记录标签页激活事件
   */
  recordTabActivation(tabId: number, fromTabId?: number): void {
    const now = Date.now();
    
    // 更新或创建节点
    if (!this.nodes.has(tabId)) {
      this.nodes.set(tabId, {
        tabId,
        weight: 0.1,
        connections: [],
        temporalDecay: 1.0,
        contextualRelevance: 0.5
      });
    }

    const node = this.nodes.get(tabId)!;
    
    // 增加权重（基于激活频率）
    node.weight = Math.min(1.0, node.weight + 0.05);
    
    // 如果有来源标签页，创建关联边
    if (fromTabId && fromTabId !== tabId) {
      this.createOrUpdateEdge(fromTabId, tabId, 'sequential');
    }

    // 更新当前会话
    this.updateSession(tabId);
  }

  /**
   * 记录标签页停留时间
   */
  recordDwellTime(tabId: number, duration: number): void {
    if (!this.nodes.has(tabId)) return;

    const node = this.nodes.get(tabId)!;
    
    // 基于停留时间调整权重
    const dwellWeight = Math.min(0.3, duration / (5 * 60 * 1000)); // 5分钟为满权重
    node.weight = Math.min(1.0, node.weight + dwellWeight);
    
    // 更新上下文相关性
    if (duration > 60 * 1000) { // 超过1分钟认为有深度阅读
      node.contextualRelevance = Math.min(1.0, node.contextualRelevance + 0.1);
    }
  }

  /**
   * 创建或更新标签页关联边
   */
  private createOrUpdateEdge(
    fromTabId: number, 
    toTabId: number, 
    contextType: AttentionEdge['contextType']
  ): void {
    if (!this.nodes.has(fromTabId)) return;

    const fromNode = this.nodes.get(fromTabId)!;
    const existingEdge = fromNode.connections.find(
      edge => edge.toTabId === toTabId
    );

    const now = Date.now();

    if (existingEdge) {
      // 更新现有边
      existingEdge.strength = Math.min(1.0, existingEdge.strength + 0.1);
      existingEdge.lastInteraction = now;
      existingEdge.interactionCount++;
    } else {
      // 创建新边
      fromNode.connections.push({
        fromTabId,
        toTabId,
        strength: 0.2,
        lastInteraction: now,
        interactionCount: 1,
        contextType
      });
    }
  }

  /**
   * 计算标签页注意力分数
   */
  calculateAttentionScore(tabInfo: TabInfo): number {
    const node = this.nodes.get(tabInfo.id);
    if (!node) return 0.1;

    // 应用时间衰减
    this.applyTemporalDecay(node);

    // 多维度权重计算
    const weights = {
      nodeWeight: 0.3,           // 节点基础权重
      contextualRelevance: 0.25, // 上下文相关性
      connectionStrength: 0.25,  // 连接强度
      recency: 0.2              // 最近访问权重
    };

    // 计算连接强度（与其他重要节点的关联度）
    const connectionScore = this.calculateConnectionScore(node);
    
    // 计算最近访问权重
    const recencyScore = this.calculateRecencyScore(tabInfo.lastAccessTime || Date.now());

    const score = 
      node.weight * weights.nodeWeight +
      node.contextualRelevance * weights.contextualRelevance +
      connectionScore * weights.connectionStrength +
      recencyScore * weights.recency;

    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * 识别工作区集群
   */
  identifyWorkClusters(tabs: TabInfo[]): { clusters: number[][], insights: string } {
    const clusters: number[][] = [];
    const visited = new Set<number>();

    // 基于强连接识别集群
    for (const tab of tabs) {
      if (visited.has(tab.id)) continue;

      const cluster = this.expandCluster(tab.id, visited);
      if (cluster.length >= 2) {
        clusters.push(cluster);
      }
    }

    // 生成洞察
    const insights = this.generateWorkflowInsights(clusters, tabs);

    return { clusters, insights };
  }

  /**
   * 扩展集群（基于连接强度）
   */
  private expandCluster(startTabId: number, visited: Set<number>): number[] {
    const cluster = [startTabId];
    const queue = [startTabId];
    visited.add(startTabId);

    while (queue.length > 0) {
      const currentTabId = queue.shift()!;
      const node = this.nodes.get(currentTabId);
      
      if (!node) continue;

      // 查找强连接的邻居节点
      for (const edge of node.connections) {
        if (edge.strength > 0.5 && !visited.has(edge.toTabId)) {
          cluster.push(edge.toTabId);
          queue.push(edge.toTabId);
          visited.add(edge.toTabId);
        }
      }
    }

    return cluster;
  }

  /**
   * 应用时间衰减
   */
  private applyTemporalDecay(node: AttentionNode): void {
    const now = Date.now();
    const hoursSinceUpdate = 1; // 简化实现，实际应计算真实时间差
    
    node.temporalDecay *= Math.pow(this.decayRate, hoursSinceUpdate);
    node.weight *= node.temporalDecay;
    
    // 衰减连接强度
    for (const edge of node.connections) {
      const hoursSinceLastInteraction = (now - edge.lastInteraction) / (1000 * 60 * 60);
      edge.strength *= Math.pow(0.95, hoursSinceLastInteraction);
    }
  }

  /**
   * 计算连接强度分数
   */
  private calculateConnectionScore(node: AttentionNode): number {
    if (node.connections.length === 0) return 0;

    const totalStrength = node.connections.reduce((sum, edge) => sum + edge.strength, 0);
    return Math.min(1.0, totalStrength / 5); // 归一化到0-1
  }

  /**
   * 计算最近访问权重
   */
  private calculateRecencyScore(lastAccessTime: number): number {
    if (!lastAccessTime) return 0.5; // 如果没有访问时间，返回中等权重
    const hoursSinceAccess = (Date.now() - lastAccessTime) / (1000 * 60 * 60);
    return Math.max(0, 1 - hoursSinceAccess / 24); // 24小时内线性衰减
  }

  /**
   * 开始新会话
   */
  private startNewSession(): void {
    this.currentSession = {
      id: `session_${Date.now()}`,
      startTime: Date.now(),
      endTime: 0,
      tabSequence: [],
      primaryFocus: [],
      sessionType: 'general',
      productivity: 0.5
    };
  }

  /**
   * 更新当前会话
   */
  private updateSession(tabId: number): void {
    if (!this.currentSession) return;

    this.currentSession.tabSequence.push(tabId);
    
    // 检查会话超时
    if (Date.now() - this.currentSession.startTime > this.sessionTimeout) {
      this.endCurrentSession();
      this.startNewSession();
    }
  }

  /**
   * 结束当前会话
   */
  private endCurrentSession(): void {
    if (!this.currentSession) return;

    this.currentSession.endTime = Date.now();
    
    // 分析会话模式并更新节点权重
    this.analyzeSessionPattern(this.currentSession);
  }

  /**
   * 分析会话模式
   */
  private analyzeSessionPattern(session: WorkSession): void {
    // 识别主要焦点标签页（访问频次最高）
    const tabFrequency = new Map<number, number>();
    
    for (const tabId of session.tabSequence) {
      tabFrequency.set(tabId, (tabFrequency.get(tabId) || 0) + 1);
    }

    // 提升主要焦点标签页的权重
    const sortedTabs = Array.from(tabFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3); // 取前3个

    for (const [tabId, frequency] of sortedTabs) {
      const node = this.nodes.get(tabId);
      if (node) {
        const boost = Math.min(0.2, frequency / session.tabSequence.length);
        node.weight = Math.min(1.0, node.weight + boost);
      }
    }
  }

  /**
   * 生成工作流洞察
   */
  private generateWorkflowInsights(clusters: number[][], tabs: TabInfo[]): string {
    if (clusters.length === 0) return '当前标签页较为分散，未发现明显的工作模式';

    const tabMap = new Map(tabs.map(tab => [tab.id, tab]));
    const insights: string[] = [];

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;

      const clusterTabs = cluster.map(id => tabMap.get(id)).filter(Boolean) as TabInfo[];
      const domains = [...new Set(clusterTabs.map(tab => tab.domain))];

      if (domains.length > 2) {
        insights.push(`发现跨平台工作流：${domains.slice(0, 2).join('、')}等`);
      } else {
        insights.push(`在${domains[0]}上的深度工作`);
      }
    }

    return insights.join('；') || '检测到多个工作区域';
  }

  /**
   * 清理过期数据
   */
  cleanup(): void {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    for (const [tabId, node] of this.nodes.entries()) {
      // 移除过期的连接边
      node.connections = node.connections.filter(
        edge => edge.lastInteraction > oneWeekAgo
      );

      // 移除权重过低的节点
      if (node.weight < 0.01) {
        this.nodes.delete(tabId);
      }
    }
  }

  /**
   * 获取图谱统计信息
   */
  getGraphStats() {
    return {
      nodeCount: this.nodes.size,
      edgeCount: Array.from(this.nodes.values()).reduce(
        (sum, node) => sum + node.connections.length, 0
      ),
      avgWeight: Array.from(this.nodes.values()).reduce(
        (sum, node) => sum + node.weight, 0
      ) / this.nodes.size
    };
  }
}