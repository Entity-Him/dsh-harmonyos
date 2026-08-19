/**
 * DshApiClient：dsh 服务的 HTTP 客户端。
 *
 * 与 dsh 官方 Web 前端使用完全相同的物理协议（@deepseek-ai/dsh-host-apiproxy）：
 * 1. 单次 RPC：POST /api/<method>
 *    body  = { type: 'client-request', rpcId, method, payload }
 *    reply = { type: 'server-response', rpcId, result: { ok, value | error } }
 * 2. 事件流：GET /api/events.mux （SSE，data: 行 + \n\n 分帧）
 *    帧内容 = { type: 'server-request', rpcId, method, payload: MuxFrame }
 *
 * 参照华为开发者文档《HTTP 数据请求》：@ohos.net.http 支持流式响应
 * （on('dataReceive') 事件），用于实现 SSE 长连接。
 */
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';

export class DshApiClient {
  private baseUrl: string = '';
  private sseRequest: http.HttpRequest | null = null;
  private sseBuffer: string = '';
  private onFrameCallback: ((frame: Record<string, Object>) => void) | null = null;
  private onOpenCallback: (() => void) | null = null;
  private onErrorCallback: ((message: string) => void) | null = null;
  private closed: boolean = true;
  /** SSE 断线自动重连（鸿蒙适配：dsh 服务可能被 dsh-update/dsh-web.sh 重启，客户端必须自动恢复） */
  private reconnectTimer: number = -1;
  private reconnectAttempt: number = 0;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private mintRpcId(): string {
    return 'rpc-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xffffff).toString(36);
  }

  /**
   * 单次 RPC 调用：POST /api/<method>，返回 result.value；业务错误抛异常
   */
  async call(method: string, payload: Record<string, Object>): Promise<Record<string, Object>> {
    const rpcId: string = this.mintRpcId();
    const envelope: Record<string, Object> = {
      'type': 'client-request',
      'rpcId': rpcId,
      'method': method,
      'payload': payload
    };
    const req: http.HttpRequest = http.createHttp();
    let resp: http.HttpResponse;
    try {
      resp = await req.request(this.baseUrl + '/api/' + method, {
        method: http.RequestMethod.POST,
        header: { 'Content-Type': 'application/json' },
        extraData: JSON.stringify(envelope),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 30000
      });
    } catch (e) {
      req.destroy();
      throw new Error('无法连接 dsh 服务：' + String(e));
    }
    req.destroy();
    if (resp.responseCode !== 200) {
      throw new Error('HTTP ' + resp.responseCode.toString());
    }
    const text: string = resp.result as string;
    const full: Record<string, Object> = JSON.parse(text) as Record<string, Object>;
    const result: Record<string, Object> = full['result'] as Record<string, Object>;
    if (result === undefined || result === null) {
      throw new Error('响应格式错误');
    }
    const ok: boolean = result['ok'] === true;
    if (ok) {
      return result['value'] as Record<string, Object>;
    }
    const err: Record<string, Object> = result['error'] as Record<string, Object>;
    let code: string = 'unknown';
    let message: string = '未知错误';
    if (err !== undefined && err !== null) {
      code = String(err['code']);
      message = String(err['message']);
    }
    throw new Error(code + ': ' + message);
  }

  /**
   * 打开全局会话事件流（SSE）：GET /api/events.mux
   * 服务端通过该流推送 session/event、session/subscribed、approval/question 等帧。
   * 断线后自动重连（指数退避 2s→4s→…→30s），直到 closeMux 被调用。
   */
  openMux(onFrame: (frame: Record<string, Object>) => void,
          onOpen: () => void,
          onError: (message: string) => void): void {
    this.closeMux();
    this.onFrameCallback = onFrame;
    this.onOpenCallback = onOpen;
    this.onErrorCallback = onError;
    this.sseBuffer = '';
    this.closed = false;
    this.reconnectAttempt = 0;
    this.startStream();
  }

  private startStream(): void {
    const req: http.HttpRequest = http.createHttp();
    this.sseRequest = req;
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');

    req.on('headersReceive', (header: Object) => {
      this.reconnectAttempt = 0;
      if (this.onOpenCallback !== null) {
        this.onOpenCallback();
      }
    });
    // 流式接收响应体（SSE 分块）
    req.on('dataReceive', (data: ArrayBuffer) => {
      const text: string = decoder.decodeToString(new Uint8Array(data), { stream: true });
      this.sseBuffer += text;
      this.dispatchFrames();
    });
    req.on('dataEnd', () => {
      if (!this.closed) {
        this.scheduleReconnect();
      }
    });

    req.request(this.baseUrl + '/api/events.mux', {
      method: http.RequestMethod.GET,
      header: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
      connectTimeout: 10000,
      readTimeout: 86400000
    }).then((resp: http.HttpResponse) => {
      if (resp.responseCode !== 200 && !this.closed) {
        this.scheduleReconnect();
      }
    }).catch((e: BusinessError) => {
      if (!this.closed) {
        this.scheduleReconnect();
      }
    });
  }

  /** 指数退避重连：2s → 4s → 8s → … → 30s 封顶 */
  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    if (this.onErrorCallback !== null) {
      this.onErrorCallback('事件流断开，自动重连中…');
    }
    let delay: number = 2000 * Math.pow(2, this.reconnectAttempt);
    if (delay > 30000) {
      delay = 30000;
    }
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      if (this.closed) {
        return;
      }
      this.startStream();
    }, delay);
  }

  /** 解析 SSE 帧：data: <json> 行，\n\n 分帧 */
  private dispatchFrames(): void {
    let idx: number = this.sseBuffer.indexOf('\n\n');
    while (idx !== -1) {
      const chunk: string = this.sseBuffer.slice(0, idx);
      this.sseBuffer = this.sseBuffer.slice(idx + 2);
      let dataStr: string = '';
      const lines: string[] = chunk.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line: string = lines[i];
        if (line.startsWith('data: ')) {
          dataStr += line.slice(6);
        }
      }
      if (dataStr.length > 0) {
        try {
          const frame: Record<string, Object> = JSON.parse(dataStr) as Record<string, Object>;
          if (this.onFrameCallback !== null) {
            this.onFrameCallback(frame);
          }
        } catch (e) {
          // 单个坏帧不影响整条流
        }
      }
      idx = this.sseBuffer.indexOf('\n\n');
    }
  }

  /** 关闭事件流（同时取消待执行的重连） */
  closeMux(): void {
    this.closed = true;
    if (this.reconnectTimer !== -1) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = -1;
    }
    if (this.sseRequest !== null) {
      this.sseRequest.destroy();
      this.sseRequest = null;
    }
  }

  // —— 会话域方法（与 RpcMethodMap 一一对应） ——

  /** session.list：列出持久化会话（updatedAt 降序） */
  async listSessions(): Promise<Array<Record<string, Object>>> {
    const value: Record<string, Object> = await this.call('session.list', {});
    const items: Array<Record<string, Object>> = value['items'] as Array<Record<string, Object>>;
    return items === undefined || items === null ? [] : items;
  }

  /** session.create：创建新会话（cwd 为空时使用 host 默认目录；agentPreset 为空时使用默认预设） */
  async createSession(cwd: string, agentPreset: string): Promise<string> {
    const payload: Record<string, Object> = {};
    if (cwd.length > 0) {
      payload['cwd'] = cwd;
    }
    if (agentPreset.length > 0) {
      payload['agentPreset'] = agentPreset;
    }
    const value: Record<string, Object> = await this.call('session.create', payload);
    return String(value['sessionId']);
  }

  /** agentPreset.list：列出部署提供的对话模式预设（鸿蒙六套 harmony-* 预设来自本仓库） */
  async agentPresetList(): Promise<Array<Record<string, Object>>> {
    const value: Record<string, Object> = await this.call('agentPreset.list', {});
    const presets: Array<Record<string, Object>> = value['presets'] as Array<Record<string, Object>>;
    return presets === undefined || presets === null ? [] : presets;
  }

  /** session.history：读取会话历史事件 */
  async history(sessionId: string, maxMessages: number): Promise<Record<string, Object>> {
    const payload: Record<string, Object> = { 'sessionId': sessionId };
    if (maxMessages > 0) {
      payload['maxMessages'] = maxMessages;
    }
    return await this.call('session.history', payload);
  }

  /** session.prompt：发送消息（mode=queue 排队执行） */
  async prompt(sessionId: string, text: string): Promise<void> {
    const content: Array<Record<string, Object>> = [];
    content.push({ 'type': 'text', 'text': text });
    const payload: Record<string, Object> = {
      'sessionId': sessionId,
      'mode': 'queue',
      'content': content
    };
    await this.call('session.prompt', payload);
  }

  /** session.cancel：停止当前回合 */
  async cancel(sessionId: string): Promise<void> {
    await this.call('session.cancel', { 'sessionId': sessionId });
  }

  /** session.rename：重命名会话 */
  async rename(sessionId: string, title: string): Promise<void> {
    const payload: Record<string, Object> = { 'sessionId': sessionId, 'title': title };
    await this.call('session.rename', payload);
  }

  /** host.describe：探测服务连通性 */
  async describe(): Promise<Record<string, Object>> {
    return await this.call('host.describe', {});
  }
}

/**
 * DeepSeekClient：内置直连模式（WorkBuddy 式「打开即用」）。
 * 不依赖 dsh 服务端，直接调用 DeepSeek 官方 API（OpenAI 兼容
 * /chat/completions，流式 SSE），与 dsh 模式共享同一套聊天 UI。
 * 参照华为开发者文档《HTTP 数据请求》：on('dataReceive') 流式解析 SSE。
 */
export class DeepSeekClient {
  private static readonly API_URL: string = 'https://api.deepseek.com/chat/completions';
  private request: http.HttpRequest | null = null;

  /** 停止当前生成（用户点「停止」） */
  stop(): void {
    if (this.request !== null) {
      this.request.destroy();
      this.request = null;
    }
  }

  /**
   * 流式对话。messages 形如 [{role: 'user'|'assistant', content: '…'}]。
   * onDelta 逐块回调增量文本；onDone 正常结束；onError 失败。
   */
  chat(apiKey: string,
       model: string,
       messages: Array<Record<string, Object>>,
       onDelta: (text: string) => void,
       onDone: () => void,
       onError: (message: string) => void): void {
    this.stop();
    const req: http.HttpRequest = http.createHttp();
    this.request = req;
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
    let buffer: string = '';
    let finished: boolean = false;

    req.on('dataReceive', (data: ArrayBuffer) => {
      if (finished) {
        return;
      }
      buffer += decoder.decodeToString(new Uint8Array(data), { stream: true });
      let idx: number = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const chunk: string = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines: string[] = chunk.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line: string = lines[i];
          if (!line.startsWith('data: ')) {
            continue;
          }
          const dataStr: string = line.slice(6).trim();
          if (dataStr === '[DONE]') {
            continue;
          }
          try {
            const json: Record<string, Object> = JSON.parse(dataStr) as Record<string, Object>;
            const choices: Array<Record<string, Object>> = json['choices'] as Array<Record<string, Object>>;
            if (choices === undefined || choices === null || choices.length === 0) {
              continue;
            }
            const delta: Record<string, Object> = choices[0]['delta'] as Record<string, Object>;
            if (delta === undefined || delta === null) {
              continue;
            }
            const content = delta['content'] as Object;
            if (content !== undefined && content !== null) {
              onDelta(String(content));
            }
          } catch (e) {
            // 单个坏块不影响整条流
          }
        }
        idx = buffer.indexOf('\n\n');
      }
    });

    req.on('dataEnd', () => {
      if (!finished) {
        finished = true;
        onDone();
      }
    });

    const body: Record<string, Object> = {
      'model': model,
      'messages': messages,
      'stream': true
    };
    req.request(DeepSeekClient.API_URL, {
      method: http.RequestMethod.POST,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      extraData: JSON.stringify(body),
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: 10000,
      readTimeout: 300000
    }).then((resp: http.HttpResponse) => {
      if (resp.responseCode !== 200 && !finished) {
        finished = true;
        let errText: string = '';
        try {
          const result = resp.result as string;
          if (result !== undefined && result !== null) {
            errText = result;
          }
        } catch (e) {
        }
        onError('HTTP ' + resp.responseCode.toString() + (errText.length > 0 ? '：' + errText : ''));
      }
    }).catch((e: BusinessError) => {
      if (!finished) {
        finished = true;
        onError('请求失败：' + String(e.message));
      }
    });
  }
}
