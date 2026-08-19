/**
 * 数据模型：与 dsh HTTP API（@deepseek-ai/dsh-host-apiproxy 契约）对应的客户端类型。
 * 参照华为开发者文档《状态管理（V1）》：@Observed 用于观察 class 属性变化，
 * 与子组件中的 @ObjectLink 配合实现消息流式增量刷新。
 */

/**
 * 单条聊天消息（UI 投影）。
 * - role: user | assistant | tool
 * - status: streaming（流式生成中）| done | running（工具执行中）| error
 */
@Observed
export class ChatMessage {
  id: string = '';
  role: string = 'assistant';
  text: string = '';
  reasoning: string = '';
  toolName: string = '';
  toolArgs: string = '';
  status: string = 'done';
  time: number = 0;

  constructor(id: string, role: string, time: number) {
    this.id = id;
    this.role = role;
    this.time = time;
  }
}

/**
 * 会话摘要（session.list 返回项的 UI 投影）
 */
@Observed
export class DshSession {
  sessionId: string = '';
  title: string = '';
  updatedAt: number = 0;
  running: boolean = false;
  blank: boolean = true;

  constructor(id: string) {
    this.sessionId = id;
    this.updatedAt = Date.now();
  }
}

/**
 * 富文本渲染块：用于消息文本中代码块与普通文本的区分
 */
export class TextBlock {
  text: string = '';
  isCode: boolean = false;

  constructor(text: string, isCode: boolean) {
    this.text = text;
    this.isCode = isCode;
  }
}
