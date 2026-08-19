/**
 * Index：主页面（桌面三栏式布局的编排中心）。
 *
 * 职责：
 * - 加载/保存服务器地址（@ohos.data.preferences）
 * - 建立 dsh 连接（describe 探测 + events.mux SSE 流）
 * - 会话列表、历史加载、消息发送/停止、实时事件折叠（foldEvent）
 *
 * 参照华为开发者文档《声明式UI语法》：
 * @Entry 页面入口、@Component 自定义组件、@State 组件内状态、
 * $$ 双向绑定（bindSheet）、@Builder 复用 UI 片段。
 */
import { Constants } from '../common/Constants';
import { Theme } from '../common/Theme';
import { DshApiClient, DeepSeekClient } from '../service/DshApiClient';
import { ChatMessage, DshSession } from '../model/Types';
import { Sidebar } from '../view/Sidebar';
import { ChatView } from '../view/ChatView';
import { SettingsPanel } from '../view/SettingsPanel';
import { preferences } from '@kit.ArkData';
import { promptAction } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';

@Entry
@Component
struct Index {
  @State serverUrl: string = Constants.DEFAULT_SERVER;
  @State connected: boolean = false;
  @State connecting: boolean = false;
  @State sessions: DshSession[] = [];
  @State currentSessionId: string = '';
  @State currentTitle: string = '';
  @State messages: ChatMessage[] = [];
  @State streaming: boolean = false;
  @State showSettings: boolean = false;
  @State statusText: string = '未连接';
  /** 部署可用的对话模式预设（鸿蒙 harmony-* 六套，来自 dsh-harmonyos 仓库） */
  @State presetIds: string[] = [];
  @State currentPreset: string = '';
  /** 连接模式：'direct' 内置直连（打开即用）/ 'dsh' dsh 服务 */
  @State mode: string = 'direct';
  @State directApiKey: string = '';
  @State directModel: string = 'deepseek-chat';
  @State directModels: string[] = Constants.DIRECT_MODELS;
  private client: DshApiClient | null = null;
  private deepseek: DeepSeekClient = new DeepSeekClient();
  private scroller: Scroller = new Scroller();

  aboutToAppear(): void {
    this.loadSettings();
  }

  aboutToDisappear(): void {
    if (this.client !== null) {
      this.client.closeMux();
    }
  }

  // —— 设置持久化 ——

  private loadSettings(): void {
    const host = this.getUIContext().getHostContext();
    if (host === undefined || host === null) {
      this.connect();
      return;
    }
    try {
      const store = preferences.getPreferencesSync(host, { name: Constants.SETTINGS_STORE });
      const saved: string = store.getSync(Constants.KEY_SERVER_URL, Constants.DEFAULT_SERVER) as string;
      this.serverUrl = saved;
      const preset: string = store.getSync(Constants.KEY_AGENT_PRESET, '') as string;
      this.currentPreset = preset;
      const mode: string = store.getSync(Constants.KEY_MODE, 'direct') as string;
      this.mode = mode;
      const dk: string = store.getSync(Constants.KEY_DIRECT_API_KEY, '') as string;
      this.directApiKey = dk;
      const dm: string = store.getSync(Constants.KEY_DIRECT_MODEL, 'deepseek-chat') as string;
      this.directModel = dm;
    } catch (e) {
      this.serverUrl = Constants.DEFAULT_SERVER;
    }
    this.applyMode();
  }

  /** 按模式初始化：direct=内置直连（打开即用）；dsh=连接服务 */
  private applyMode(): void {
    if (this.mode === 'dsh') {
      this.connect();
    } else {
      this.deepseek.stop();
      this.connected = true;
      this.statusText = '直连模式（内置，打开即用）';
      this.connecting = false;
    }
  }

  private saveServerUrl(): void {
    const host = this.getUIContext().getHostContext();
    if (host === undefined || host === null) {
      return;
    }
    try {
      const store = preferences.getPreferencesSync(host, { name: Constants.SETTINGS_STORE });
      store.putSync(Constants.KEY_SERVER_URL, this.serverUrl);
      store.flush();
    } catch (e) {
      // 保存失败不阻塞
    }
  }

  private saveAgentPreset(preset: string): void {
    const host = this.getUIContext().getHostContext();
    if (host === undefined || host === null) {
      return;
    }
    try {
      const store = preferences.getPreferencesSync(host, { name: Constants.SETTINGS_STORE });
      store.putSync(Constants.KEY_AGENT_PRESET, preset);
      store.flush();
    } catch (e) {
      // 保存失败不阻塞
    }
  }

  /** 保存连接模式偏好 */
  private saveMode(mode: string): void {
    const host = this.getUIContext().getHostContext();
    if (host === undefined || host === null) {
      return;
    }
    try {
      const store = preferences.getPreferencesSync(host, { name: Constants.SETTINGS_STORE });
      store.putSync(Constants.KEY_MODE, mode);
      store.flush();
    } catch (e) {
      // 保存失败不阻塞
    }
  }

  /** 保存直连模式配置（API Key + 模型，存应用本地，不经过服务端） */
  private saveDirectConfig(): void {
    const host = this.getUIContext().getHostContext();
    if (host === undefined || host === null) {
      return;
    }
    try {
      const store = preferences.getPreferencesSync(host, { name: Constants.SETTINGS_STORE });
      store.putSync(Constants.KEY_DIRECT_API_KEY, this.directApiKey);
      store.putSync(Constants.KEY_DIRECT_MODEL, this.directModel);
      store.flush();
    } catch (e) {
      // 保存失败不阻塞
    }
  }

  /** 拉取部署提供的对话模式预设（agentPreset.list），供设置面板选择 */
  private loadPresets(): void {
    const client = this.client;
    if (client === null) {
      return;
    }
    client.agentPresetList().then((items: Array<Record<string, Object>>) => {
      const ids: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const broken = items[i]['broken'];
        if (broken !== undefined && broken !== null) {
          continue; // broken 预设不可选
        }
        ids.push(String(items[i]['id']));
      }
      this.presetIds = ids;
      if (this.currentPreset.length > 0 && ids.indexOf(this.currentPreset) === -1) {
        this.currentPreset = '';
      }
    }).catch((e: BusinessError) => {
      this.statusText = '预设加载失败：' + String(e);
    });
  }

  // —— 连接 ——

  private connect(): void {
    if (this.connecting) {
      return;
    }
    this.connecting = true;
    this.statusText = '连接中…';
    const client: DshApiClient = new DshApiClient(this.serverUrl);
    this.client = client;
    client.openMux(
      (frame: Record<string, Object>) => { this.onMuxFrame(frame); },
      () => {
        // 事件流建立（含断线自动重连成功）：恢复连接态并刷新会话列表
        this.connected = true;
        this.statusText = '已连接';
        this.refreshSessions();
      },
      (msg: string) => {
        this.connected = false;
        this.statusText = msg;
      }
    );
    client.describe().then(() => {
      this.connected = true;
      this.statusText = '已连接';
      this.connecting = false;
      this.refreshSessions();
    }).catch((e: BusinessError) => {
      this.connecting = false;
      this.connected = false;
      this.statusText = '未连接：服务未启动？先在鸿蒙终端运行 sh ~/bin/dsh-web.sh（自动探测中…）';
    });
  }

  private refreshSessions(): void {
    const client = this.client;
    if (client === null) {
      return;
    }
    client.listSessions().then((items: Array<Record<string, Object>>) => {
      const list: DshSession[] = [];
      for (let i = 0; i < items.length; i++) {
        const raw: Record<string, Object> = items[i];
        const session: DshSession = new DshSession(String(raw['sessionId']));
        session.updatedAt = Number(raw['updatedAt']);
        session.running = raw['running'] === true;
        session.blank = raw['blank'] === true;
        const proj: Record<string, Object> = raw['projections'] as Record<string, Object>;
        if (proj !== undefined && proj !== null) {
          const values: Record<string, Object> = proj['values'] as Record<string, Object>;
          if (values !== undefined && values !== null) {
            const title = values['title'];
            if (title !== undefined && title !== null) {
              session.title = String(title);
            }
          }
        }
        list.push(session);
      }
      // 合并旧标题（避免刷新时丢失本地自动标题）
      if (this.sessions.length > 0) {
        for (let i = 0; i < list.length; i++) {
          if (list[i].title.length === 0) {
            for (let j = 0; j < this.sessions.length; j++) {
              if (this.sessions[j].sessionId === list[i].sessionId && this.sessions[j].title.length > 0) {
                list[i].title = this.sessions[j].title;
                break;
              }
            }
          }
        }
      }
      this.sessions = list;
      // 自动选中第一个非空会话
      if (this.currentSessionId.length === 0 && list.length > 0) {
        for (let i = 0; i < list.length; i++) {
          if (!list[i].blank) {
            this.selectSession(list[i].sessionId);
            return;
          }
        }
        this.selectSession(list[0].sessionId);
      }
    }).catch((e: BusinessError) => {
      this.statusText = String(e);
    });
  }

  // —— 会话 ——

  private newSession(): void {
    if (this.mode === 'direct') {
      // 内置直连：新建会话 = 清空本地消息
      this.deepseek.stop();
      this.messages = [];
      this.currentTitle = '本机会话';
      this.streaming = false;
      return;
    }
    const client = this.client;
    if (client === null) {
      return;
    }
    client.createSession('', this.currentPreset).then((sessionId: string) => {
      const session: DshSession = new DshSession(sessionId);
      const list: DshSession[] = [];
      list.push(session);
      for (let i = 0; i < this.sessions.length; i++) {
        list.push(this.sessions[i]);
      }
      this.sessions = list;
      this.selectSession(sessionId);
    }).catch((e: BusinessError) => {
      this.statusText = String(e);
    });
  }

  private selectSession(sessionId: string): void {
    if (this.mode === 'direct') {
      return; // 直连模式为单会话工作区
    }
    const client = this.client;
    if (client === null) {
      return;
    }
    if (sessionId === this.currentSessionId && this.messages.length > 0) {
      return;
    }
    this.currentSessionId = sessionId;
    this.currentTitle = '';
    for (let i = 0; i < this.sessions.length; i++) {
      if (this.sessions[i].sessionId === sessionId) {
        this.currentTitle = this.sessions[i].title;
        break;
      }
    }
    this.messages = [];
    this.streaming = false;
    client.history(sessionId, Constants.HISTORY_MAX_MESSAGES).then((value: Record<string, Object>) => {
      const events: Array<Record<string, Object>> = value['events'] as Array<Record<string, Object>>;
      if (events === undefined || events === null) {
        return;
      }
      const list: ChatMessage[] = [];
      let current: ChatMessage | null = null;
      for (let i = 0; i < events.length; i++) {
        const entry: Record<string, Object> = events[i];
        const ev: Record<string, Object> = entry['event'] as Record<string, Object>;
        if (ev === undefined || ev === null) {
          continue;
        }
        current = this.foldEvent(ev, list, current);
      }
      this.messages = list;
      if (this.currentTitle.length === 0) {
        for (let i = 0; i < list.length; i++) {
          if (list[i].role === 'user' && list[i].text.length > 0) {
            const t: string = list[i].text.length > Constants.TITLE_MAX_CHARS ?
              list[i].text.slice(0, Constants.TITLE_MAX_CHARS) : list[i].text;
            this.currentTitle = t;
            this.updateSessionTitleLocal(sessionId, t);
            break;
          }
        }
      }
      this.scrollToBottom();
    }).catch((e: BusinessError) => {
      this.statusText = String(e);
    });
  }

  private updateSessionTitleLocal(sessionId: string, title: string): void {
    const list: DshSession[] = this.sessions.slice();
    for (let i = 0; i < list.length; i++) {
      if (list[i].sessionId === sessionId) {
        list[i].title = title;
        break;
      }
    }
    this.sessions = list;
  }

  private sendMessage(text: string): void {
    if (this.mode === 'direct') {
      this.sendDirect(text);
      return;
    }
    this.sendDsh(text);
  }

  /** 内置直连模式：直接调 DeepSeek 官方 API 流式对话（WorkBuddy 式打开即用） */
  private sendDirect(text: string): void {
    if (this.directApiKey.length === 0) {
      // 未配置 Key：Toast 提示并直接打开设置
      promptAction.showToast({ message: '请先在「设置」→「直连配置」填写 API Key' });
      this.showSettings = true;
      return;
    }
    // 乐观插入用户消息
    const userMsg: ChatMessage = new ChatMessage('local-' + Date.now().toString(), 'user', Date.now());
    userMsg.text = text;
    userMsg.status = 'done';
    const list: ChatMessage[] = this.messages.slice();
    list.push(userMsg);
    this.messages = list;
    // 组装历史（user/assistant 文本）
    const history: Array<Record<string, Object>> = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].role === 'user' || list[i].role === 'assistant') {
        const item: Record<string, Object> = { 'role': list[i].role, 'content': list[i].text };
        history.push(item);
      }
    }
    // 流式占位
    const assistant: ChatMessage = new ChatMessage('direct-' + Date.now().toString(), 'assistant', Date.now());
    assistant.status = 'streaming';
    const list2: ChatMessage[] = this.messages.slice();
    list2.push(assistant);
    this.messages = list2;
    this.streaming = true;
    this.scrollToBottom();
    this.deepseek.chat(this.directApiKey, this.directModel, history,
      (delta: string) => {
        const msgs: ChatMessage[] = this.messages.slice();
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'assistant' && msgs[i].status === 'streaming') {
            msgs[i].text += delta;
            break;
          }
        }
        this.messages = msgs;
        this.scrollToBottom();
      },
      () => {
        const msgs: ChatMessage[] = this.messages.slice();
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'assistant' && msgs[i].status === 'streaming') {
            msgs[i].status = 'done';
            break;
          }
        }
        this.messages = msgs;
        this.streaming = false;
        if (this.currentTitle.length === 0) {
          const t: string = text.length > Constants.TITLE_MAX_CHARS ?
            text.slice(0, Constants.TITLE_MAX_CHARS) : text;
          this.currentTitle = t;
        }
      },
      (err: string) => {
        const msgs: ChatMessage[] = this.messages.slice();
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'assistant' && msgs[i].status === 'streaming') {
            msgs[i].status = 'error';
            break;
          }
        }
        this.messages = msgs;
        this.streaming = false;
        this.statusText = err;
      });
  }

  /** dsh 服务模式：走 dsh 的 session.prompt + SSE 事件流 */
  private sendDsh(text: string): void {
    const sessionId: string = this.currentSessionId;
    const client = this.client;
    if (client === null || sessionId.length === 0) {
      return;
    }
    // 乐观插入用户消息
    const userMsg: ChatMessage = new ChatMessage('local-' + Date.now().toString(), 'user', Date.now());
    userMsg.text = text;
    userMsg.status = 'done';
    const list: ChatMessage[] = this.messages.slice();
    list.push(userMsg);
    this.messages = list;
    this.streaming = true;
    this.scrollToBottom();
    client.prompt(sessionId, text).then(() => {
      if (this.currentTitle.length === 0) {
        const t: string = text.length > Constants.TITLE_MAX_CHARS ?
          text.slice(0, Constants.TITLE_MAX_CHARS) : text;
        this.currentTitle = t;
        this.updateSessionTitleLocal(sessionId, t);
      }
    }).catch((e: BusinessError) => {
      this.streaming = false;
      this.statusText = String(e);
    });
  }

  private stopGeneration(): void {
    if (this.mode === 'direct') {
      this.deepseek.stop();
      this.streaming = false;
      const msgs: ChatMessage[] = this.messages.slice();
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant' && msgs[i].status === 'streaming') {
          msgs[i].status = 'done';
          break;
        }
      }
      this.messages = msgs;
      return;
    }
    const client = this.client;
    if (client === null || this.currentSessionId.length === 0) {
      return;
    }
    client.cancel(this.currentSessionId).then(() => {
      this.streaming = false;
    }).catch((e: BusinessError) => {
      this.statusText = String(e);
    });
  }

  // —— SSE 帧处理 ——

  private onMuxFrame(frame: Record<string, Object>): void {
    if (frame === undefined || frame === null) {
      return;
    }
    const payload: Record<string, Object> = frame['payload'] as Record<string, Object>;
    if (payload === undefined || payload === null) {
      return;
    }
    const frameType: string = String(payload['type']);
    if (frameType === 'session/event') {
      const sessionId: string = String(payload['sessionId']);
      const ev: Record<string, Object> = payload['event'] as Record<string, Object>;
      if (ev === undefined || ev === null) {
        return;
      }
      if (sessionId !== this.currentSessionId) {
        this.updateSessionRunning(sessionId, ev);
        return;
      }
      const list: ChatMessage[] = this.messages.slice();
      let current: ChatMessage | null = null;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].role === 'assistant' && list[i].status === 'streaming') {
          current = list[i];
          break;
        }
      }
      this.foldEvent(ev, list, current);
      this.messages = list;
      this.scrollToBottom();
    } else if (frameType === 'stream/error') {
      const err: Record<string, Object> = payload['error'] as Record<string, Object>;
      let msg: string = '流错误';
      if (err !== undefined && err !== null) {
        msg = '流错误：' + String(err['message']);
      }
      this.statusText = msg;
    }
  }

  private updateSessionRunning(sessionId: string, ev: Record<string, Object>): void {
    const type: string = String(ev['type']);
    const isRunning: boolean = type === 'turn/start';
    const list: DshSession[] = this.sessions.slice();
    for (let i = 0; i < list.length; i++) {
      if (list[i].sessionId === sessionId) {
        list[i].running = isRunning;
        break;
      }
    }
    this.sessions = list;
  }

  // —— 事件折叠：SessionEvent -> ChatMessage 列表 ——

  private foldEvent(ev: Record<string, Object>,
                    list: ChatMessage[],
                    current: ChatMessage | null): ChatMessage | null {
    const type: string = String(ev['type']);
    const time: number = Number(ev['time']);
    const data: Record<string, Object> = ev['data'] as Record<string, Object>;
    if (data === undefined || data === null) {
      return current;
    }
    if (type === 'user/message') {
      const content: Array<Record<string, Object>> = data['content'] as Array<Record<string, Object>>;
      const msg: ChatMessage = new ChatMessage(String(data['id']), 'user', time);
      msg.text = this.blocksToText(content);
      msg.status = 'done';
      list.push(msg);
      return current;
    }
    if (type === 'assistant/chunk') {
      const chunk: Record<string, Object> = data['chunk'] as Record<string, Object>;
      if (chunk === undefined || chunk === null) {
        return current;
      }
      const chunkType: string = String(chunk['type']);
      if (current === null) {
        current = new ChatMessage('stream-' + String(data['turn']), 'assistant', time);
        current.status = 'streaming';
        list.push(current);
      }
      if (chunkType === 'text-delta') {
        current.text += String(chunk['text']);
      } else if (chunkType === 'reasoning-delta') {
        current.reasoning += String(chunk['text']);
      }
      return current;
    }
    if (type === 'assistant/message') {
      const message: Record<string, Object> = data['message'] as Record<string, Object>;
      const id: string = String(message['id']);
      const text: string = this.blocksToText(message['content'] as Array<Record<string, Object>>);
      if (current !== null && current.status === 'streaming') {
        current.id = id;
        current.text = text;
        current.status = 'done';
        current.time = time;
        return null;
      }
      const msg: ChatMessage = new ChatMessage(id, 'assistant', time);
      msg.text = text;
      msg.status = 'done';
      list.push(msg);
      return current;
    }
    if (type === 'tool/call') {
      const msg: ChatMessage = new ChatMessage('tool-' + String(data['callId']), 'tool', time);
      msg.toolName = String(data['name']);
      msg.toolArgs = String(data['arguments']);
      msg.status = 'running';
      list.push(msg);
      return current;
    }
    if (type === 'tool/result') {
      const message: Record<string, Object> = data['message'] as Record<string, Object>;
      let callId: string = '';
      if (message !== undefined && message !== null) {
        const toolCallId = message['toolCallId'];
        if (toolCallId !== undefined && toolCallId !== null) {
          callId = String(toolCallId);
        }
      }
      if (callId.length > 0) {
        const targetId: string = 'tool-' + callId;
        for (let i = 0; i < list.length; i++) {
          if (list[i].id === targetId) {
            const err = data['error'];
            list[i].status = err !== undefined && err !== null ? 'error' : 'done';
            break;
          }
        }
      }
      return current;
    }
    if (type === 'turn/start') {
      this.streaming = true;
      return current;
    }
    if (type === 'turn/end') {
      this.streaming = false;
      return current;
    }
    if (type === 'session/title') {
      const title = data['title'];
      if (title !== undefined && title !== null) {
        this.currentTitle = String(title);
      }
      return current;
    }
    return current;
  }

  private blocksToText(blocks: Array<Record<string, Object>>): string {
    if (blocks === undefined || blocks === null) {
      return '';
    }
    let text: string = '';
    for (let i = 0; i < blocks.length; i++) {
      const block: Record<string, Object> = blocks[i];
      if (block === undefined || block === null) {
        continue;
      }
      if (String(block['type']) === 'text') {
        const t = block['text'];
        if (t !== undefined && t !== null) {
          text += String(t);
        }
      }
    }
    return text;
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      this.scroller.scrollEdge(Edge.Bottom);
    }, 50);
  }

  // —— UI ——

  build() {
    Stack() {
      Row() {
        Sidebar({
          sessions: $sessions,
          currentSessionId: this.currentSessionId,
          connected: this.connected,
          statusText: this.statusText,
          directMode: this.mode === 'direct',
          onSelect: (id: string) => { this.selectSession(id); },
          onNew: () => { this.newSession(); },
          onSettings: () => {
            this.showSettings = true;
            this.loadPresets();
          }
        })
        ChatView({
          title: this.currentTitle,
          messages: $messages,
          streaming: this.streaming,
          connected: this.connected,
          directMode: this.mode === 'direct',
          scroller: this.scroller,
          onSend: (text: string) => { this.sendMessage(text); },
          onStop: () => { this.stopGeneration(); }
        })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(Theme.COLOR_BG)

      // 设置抽屉：右侧滑出面板 + 半透明遮罩（替代 bindSheet，2in1 桌面形态更可靠）
      if (this.showSettings) {
        Column()
          .width('100%')
          .height('100%')
          .backgroundColor('#66000000')
          .onClick(() => {
            this.showSettings = false;
          })
        SettingsPanel({
          serverUrl: this.serverUrl,
          connected: this.connected,
          statusText: this.statusText,
          presetIds: this.presetIds,
          currentPreset: this.currentPreset,
          client: this.client,
          mode: this.mode,
          directApiKey: this.directApiKey,
          directModel: this.directModel,
          directModels: this.directModels,
          onModeChange: (m: string) => {
            this.mode = m;
            this.saveMode(m);
            this.applyMode();
          },
          onSaveDirect: (key: string, model: string) => {
            this.directApiKey = key;
            this.directModel = model;
            this.saveDirectConfig();
          },
          onSave: (url: string) => {
            this.serverUrl = url;
            this.saveServerUrl();
            this.connect();
          },
          onPresetSelect: (preset: string) => {
            this.currentPreset = preset;
            this.saveAgentPreset(preset);
          },
          onClose: () => {
            this.showSettings = false;
          }
        })
        .width(400)
        .height('100%')
        .align(Alignment.End)
        .border({ width: { left: 1 }, color: Theme.COLOR_BORDER })
      }
    }
    .width('100%')
    .height('100%')
  }
}
