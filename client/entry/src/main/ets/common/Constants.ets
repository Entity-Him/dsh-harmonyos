/**
 * 全局常量定义
 */
export class Constants {
  /** 默认连接的 dsh 服务地址（本机 web 服务） */
  static readonly DEFAULT_SERVER: string = 'http://127.0.0.1:3080';
  /** 应用名 */
  static readonly APP_NAME: string = 'DeepSeek Harness';
  /** 本地设置存储名称（@ohos.data.preferences） */
  static readonly SETTINGS_STORE: string = 'dsh_client_settings';
  /** 服务器地址存储键 */
  static readonly KEY_SERVER_URL: string = 'server_url';
  /** 默认对话模式（鸿蒙 agent preset）存储键 */
  static readonly KEY_AGENT_PRESET: string = 'agent_preset';
  /** 连接模式存储键：'direct'（内置直连，打开即用）/ 'dsh'（dsh 服务） */
  static readonly KEY_MODE: string = 'mode';
  /** 直连模式 API Key 存储键（存应用本地 preferences，不经过服务端） */
  static readonly KEY_DIRECT_API_KEY: string = 'direct_api_key';
  /** 直连模式默认模型存储键 */
  static readonly KEY_DIRECT_MODEL: string = 'direct_model';
  /** 直连模式可选模型 */
  static readonly DIRECT_MODELS: string[] = ['deepseek-chat', 'deepseek-reasoner'];
  /** 历史消息加载上限（条，会话级） */
  static readonly HISTORY_MAX_MESSAGES: number = 200;
  /** 会话列表标题最长字符数（自动截断） */
  static readonly TITLE_MAX_CHARS: number = 32;
}
