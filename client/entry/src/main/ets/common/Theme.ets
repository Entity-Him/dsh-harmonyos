/**
 * 主题设计令牌（DeepSeek 品牌深色主题）
 * 参照华为开发者文档《主题应用》：集中管理颜色、字号，避免散落魔法值
 */
export class Theme {
  // —— 背景色 ——
  static readonly COLOR_BG: string = '#101318';
  static readonly COLOR_SIDEBAR: string = '#151A22';
  static readonly COLOR_SURFACE: string = '#1C212B';
  static readonly COLOR_SURFACE_HOVER: string = '#232936';
  // —— 边框 ——
  static readonly COLOR_BORDER: string = '#2A3140';
  // —— 文字 ——
  static readonly COLOR_TEXT: string = '#E6E8EB';
  static readonly COLOR_SUBTEXT: string = '#8A919E';
  // —— 品牌主色（DeepSeek 蓝） ——
  static readonly COLOR_PRIMARY: string = '#4D6BFE';
  static readonly COLOR_PRIMARY_DARK: string = '#3A55E0';
  // —— 气泡 ——
  static readonly COLOR_USER_BUBBLE: string = '#4D6BFE';
  static readonly COLOR_ASSISTANT_BUBBLE: string = '#1C212B';
  static readonly COLOR_CODE_BG: string = '#0D0F14';
  // —— 状态色 ——
  static readonly COLOR_SUCCESS: string = '#3DD68C';
  static readonly COLOR_ERROR: string = '#F76560';
  static readonly COLOR_WARNING: string = '#F7A84B';
  // —— 字号 ——
  static readonly FONT_TITLE: number = 18;
  static readonly FONT_BODY: number = 15;
  static readonly FONT_SMALL: number = 12;
  static readonly FONT_MONO: string = 'monospace';
}
