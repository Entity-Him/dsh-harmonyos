/**
 * SettingsPanel：设置面板（右侧抽屉内容）。
 *
 * 支持两种连接模式：
 * - 内置直连（direct，默认）：不依赖 dsh 服务端，填 DeepSeek API Key 即用（WorkBuddy 式打开即用）
 * - dsh 服务（dsh）：对接本机/局域网 dsh，含服务端模型配置（settings.update）、预设、服务地址
 */
import { Theme } from '../common/Theme';
import { DshApiClient } from '../service/DshApiClient';
import { BusinessError } from '@kit.BasicServicesKit';

@Component
export struct SettingsPanel {
  @Prop serverUrl: string = '';
  @Prop connected: boolean = false;
  @Prop statusText: string = '';
  @Prop @Watch('onPresetsChanged') presetIds: string[] = [];
  @Prop currentPreset: string = '';
  @Prop mode: string = 'direct';
  @Prop directApiKey: string = '';
  @Prop directModel: string = 'deepseek-chat';
  @Prop directModels: string[] = [];
  client: DshApiClient | null = null;
  onModeChange: (mode: string) => void = () => {};
  onSaveDirect: (key: string, model: string) => void = () => {};
  onSave: (url: string) => void = () => {};
  onPresetSelect: (preset: string) => void = () => {};
  onClose: () => void = () => {};
  @State urlInput: string = '';
  @State presetIndex: number = 0;
  @State presetOptions: SelectOption[] = [];
  @State modeIndex: number = 0;
  @State directKeyInput: string = '';
  @State directModelIndex: number = 0;
  // —— dsh 服务端模型配置状态 ——
  @State providerName: string = '';
  @State providerActive: boolean = false;
  @State apiKeySet: boolean = false;
  @State apiKeyInput: string = '';
  @State modelIds: string[] = [];
  @State modelOptions: SelectOption[] = [];
  @State modelIndex: number = 0;
  @State currentModel: string = '';
  @State modelStatus: string = '';
  private settingsNs: string = '';
  private expectedRevision: number = 0;

  aboutToAppear(): void {
    this.urlInput = this.serverUrl;
    this.rebuildPreset();
    this.modeIndex = this.mode === 'dsh' ? 1 : 0;
    this.directKeyInput = '';
    this.directModelIndex = 0;
    for (let i = 0; i < this.directModels.length; i++) {
      if (this.directModels[i] === this.directModel) {
        this.directModelIndex = i;
        break;
      }
    }
    if (this.mode === 'dsh') {
      this.loadModelConfig();
    }
  }

  onPresetsChanged(): void {
    this.rebuildPreset();
  }

  /** 重建预设下拉选项并校正选中索引（@Watch 响应预设列表异步加载完成） */
  private rebuildPreset(): void {
    const opts: SelectOption[] = [];
    for (let i = 0; i < this.presetIds.length; i++) {
      opts.push({ value: this.presetIds[i] });
    }
    this.presetOptions = opts;
    this.presetIndex = 0;
    for (let i = 0; i < this.presetIds.length; i++) {
      if (this.presetIds[i] === this.currentPreset) {
        this.presetIndex = i;
        break;
      }
    }
  }

  private buildDirectModelOptions(): SelectOption[] {
    const opts: SelectOption[] = [];
    for (let i = 0; i < this.directModels.length; i++) {
      opts.push({ value: this.directModels[i] });
    }
    return opts;
  }

  /** 保存直连配置（API Key + 模型），回调 Index 持久化到本地 */
  private saveDirect(): void {
    const key: string = this.directKeyInput.trim();
    if (key.length === 0) {
      return;
    }
    let model: string = this.directModel;
    if (this.directModelIndex >= 0 && this.directModelIndex < this.directModels.length) {
      model = this.directModels[this.directModelIndex];
    }
    this.onSaveDirect(key, model);
    this.directKeyInput = '';
    this.modelStatus = '直连配置已保存（API Key 存于本机）';
  }

  /**
   * 加载 dsh 服务端模型配置：llm.providers → llm.models → settings.describe
   */
  private loadModelConfig(): void {
    const c = this.client;
    if (c === null) {
      return;
    }
    c.call('llm.providers', {}).then((v: Record<string, Object>) => {
      const providers: Array<Record<string, Object>> = v['providers'] as Array<Record<string, Object>>;
      if (providers !== undefined && providers !== null && providers.length > 0) {
        const p: Record<string, Object> = providers[0];
        const name = p['displayName'];
        this.providerName = name !== undefined && name !== null ? String(name) : String(p['provider']);
        this.providerActive = p['active'] === true;
        const ns = p['settingsNs'];
        this.settingsNs = ns !== undefined && ns !== null ? String(ns) : '';
      } else {
        this.providerName = '（未检测到可配置的模型提供商）';
      }
      return c.call('llm.models', {});
    }).then((v2: Record<string, Object>) => {
      const groups: Array<Record<string, Object>> = v2['groups'] as Array<Record<string, Object>>;
      const ids: string[] = [];
      if (groups !== undefined && groups !== null) {
        for (let i = 0; i < groups.length; i++) {
          const models: Array<Record<string, Object>> = groups[i]['models'] as Array<Record<string, Object>>;
          if (models === undefined || models === null) {
            continue;
          }
          for (let j = 0; j < models.length; j++) {
            ids.push(String(models[j]['id']));
          }
        }
      }
      this.modelIds = ids;
      const opts: SelectOption[] = [];
      for (let i = 0; i < ids.length; i++) {
        opts.push({ value: ids[i] });
      }
      this.modelOptions = opts;
      return c.call('settings.describe', {});
    }).then((v3: Record<string, Object>) => {
      if (this.settingsNs.length === 0) {
        return;
      }
      const namespaces: Array<Record<string, Object>> = v3['namespaces'] as Array<Record<string, Object>>;
      if (namespaces === undefined || namespaces === null) {
        return;
      }
      for (let i = 0; i < namespaces.length; i++) {
        const ns: Record<string, Object> = namespaces[i];
        if (String(ns['ns']) !== this.settingsNs) {
          continue;
        }
        this.expectedRevision = Number(ns['revision']);
        const secrets: Array<Record<string, Object>> = ns['secrets'] as Array<Record<string, Object>>;
        if (secrets !== undefined && secrets !== null) {
          for (let j = 0; j < secrets.length; j++) {
            const path: string[] = secrets[j]['path'] as string[];
            if (path !== undefined && path !== null && path.length > 0 && path[0] === 'apiKey') {
              this.apiKeySet = secrets[j]['set'] === true;
            }
          }
        }
        const value: Record<string, Object> = ns['value'] as Record<string, Object>;
        if (value !== undefined && value !== null) {
          const model = value['model'];
          if (model !== undefined && model !== null) {
            this.currentModel = String(model);
            for (let k = 0; k < this.modelIds.length; k++) {
              if (this.modelIds[k] === this.currentModel) {
                this.modelIndex = k;
                break;
              }
            }
          }
        }
        break;
      }
    }).catch((e: BusinessError) => {
      this.modelStatus = '模型配置加载失败（请确认已连接）';
    });
  }

  /** 写入 dsh 服务端 API Key：settings.update({ns, patch: {apiKey}}) */
  private saveApiKey(): void {
    const c = this.client;
    const key: string = this.apiKeyInput.trim();
    if (c === null || this.settingsNs.length === 0 || key.length === 0) {
      return;
    }
    const patch: Record<string, Object> = { 'apiKey': key };
    c.call('settings.update', {
      'ns': this.settingsNs,
      'patch': patch,
      'expectedRevision': this.expectedRevision
    }).then((v: Record<string, Object>) => {
      this.apiKeySet = true;
      this.apiKeyInput = '';
      this.expectedRevision = Number(v['revision']);
      this.modelStatus = 'API Key 已保存';
    }).catch((e: BusinessError) => {
      this.modelStatus = 'API Key 保存失败：' + String(e);
    });
  }

  /** 写入 dsh 服务端默认模型：settings.update({ns, patch: {model}}) */
  private saveModel(): void {
    const c = this.client;
    if (c === null || this.settingsNs.length === 0) {
      return;
    }
    if (this.modelIndex < 0 || this.modelIndex >= this.modelIds.length) {
      return;
    }
    const modelId: string = this.modelIds[this.modelIndex];
    const patch: Record<string, Object> = { 'model': modelId };
    c.call('settings.update', {
      'ns': this.settingsNs,
      'patch': patch,
      'expectedRevision': this.expectedRevision
    }).then((v: Record<string, Object>) => {
      this.currentModel = modelId;
      this.expectedRevision = Number(v['revision']);
      this.modelStatus = '模型已切换：' + modelId;
    }).catch((e: BusinessError) => {
      this.modelStatus = '模型保存失败：' + String(e);
    });
  }

  build() {
    Column() {
      // 固定头部
      Row() {
        Text('设置')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(Theme.COLOR_TEXT)
        Blank()
        Button('✕')
          .width(34)
          .height(34)
          .fontSize(15)
          .fontColor(Theme.COLOR_SUBTEXT)
          .backgroundColor(Theme.COLOR_SURFACE)
          .borderRadius(17)
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 16, bottom: 10 })
      .border({ width: { bottom: 1 }, color: Theme.COLOR_BORDER })

      // 可滚动内容区
      Scroll() {
        Column({ space: 16 }) {
          // —— 连接模式 ——
          Text('连接模式')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.COLOR_TEXT)
            .width('100%')
          Select([{ value: '内置直连（打开即用）' }, { value: 'dsh 服务' }])
            .selected(this.modeIndex)
            .value(this.mode === 'dsh' ? 'dsh 服务' : '内置直连（打开即用）')
            .font({ size: 14 })
            .fontColor(Theme.COLOR_TEXT)
            .selectedOptionFont({ size: 14 })
            .optionFont({ size: 14 })
            .backgroundColor(Theme.COLOR_SURFACE)
            .borderRadius(10)
            .onSelect((index: number, value: string) => {
              this.modeIndex = index;
              this.onModeChange(index === 1 ? 'dsh' : 'direct');
              if (index === 1) {
                this.loadModelConfig();
              }
            })

          // —— 对话模式预设（两种模式下都可用；直连模式先选好，切回 dsh 模式时生效） ——
          Column({ space: 6 }) {
            Text('默认对话模式（鸿蒙 harmony-* 六套预设）')
              .fontSize(12)
              .fontColor(Theme.COLOR_SUBTEXT)
              .width('100%')
            if (this.presetIds.length > 0) {
              Select(this.presetOptions)
                .selected(this.presetIndex)
                .value(this.currentPreset.length > 0 ? this.currentPreset : '（使用部署默认）')
                .font({ size: 14 })
                .fontColor(Theme.COLOR_TEXT)
                .selectedOptionFont({ size: 14 })
                .optionFont({ size: 14 })
                .backgroundColor(Theme.COLOR_SURFACE)
                .borderRadius(10)
                .onSelect((index: number, value: string) => {
                  this.presetIndex = index;
                  if (index >= 0 && index < this.presetIds.length) {
                    this.onPresetSelect(this.presetIds[index]);
                  }
                })
            } else {
              Text('（未连接 dsh 服务，无法获取预设列表）')
                .fontSize(12)
                .fontColor(Theme.COLOR_SUBTEXT)
                .width('100%')
            }
          }
          .width('100%')

          if (this.mode === 'direct') {
            // —— 内置直连配置（WorkBuddy 式打开即用） ——
            Text('直连配置')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.COLOR_TEXT)
              .width('100%')
            Column({ space: 6 }) {
              Text('DeepSeek API Key（保存于本机）')
                .fontSize(12)
                .fontColor(Theme.COLOR_SUBTEXT)
                .width('100%')
              TextInput({ text: this.directKeyInput, placeholder: 'sk-…' })
                .width('100%')
                .height(44)
                .fontSize(14)
                .type(InputType.Password)
                .fontColor(Theme.COLOR_TEXT)
                .placeholderColor(Theme.COLOR_SUBTEXT)
                .backgroundColor(Theme.COLOR_SURFACE)
                .borderRadius(10)
                .onChange((value: string) => {
                  this.directKeyInput = value;
                })
              if (this.directModels.length > 0) {
                Select(this.buildDirectModelOptions())
                  .selected(this.directModelIndex)
                  .value(this.directModel)
                  .font({ size: 14 })
                  .fontColor(Theme.COLOR_TEXT)
                  .selectedOptionFont({ size: 14 })
                  .optionFont({ size: 14 })
                  .backgroundColor(Theme.COLOR_SURFACE)
                  .borderRadius(10)
                  .onSelect((index: number, value: string) => {
                    this.directModelIndex = index;
                  })
              }
              Button('保存直连配置')
                .width('100%')
                .height(40)
                .fontSize(14)
                .backgroundColor(Theme.COLOR_PRIMARY)
                .fontColor(Color.White)
                .borderRadius(10)
                .onClick(() => {
                  this.saveDirect();
                })
              if (this.modelStatus.length > 0) {
                Text(this.modelStatus)
                  .fontSize(12)
                  .fontColor(Theme.COLOR_WARNING)
                  .width('100%')
              }
            }
            .width('100%')
            .padding(12)
            .backgroundColor(Theme.COLOR_SURFACE)
            .borderRadius(12)
          } else {
            // —— dsh 服务模式 ——
            Text('服务器连接')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.COLOR_TEXT)
              .width('100%')

            Column({ space: 6 }) {
              Text('dsh 服务地址')
                .fontSize(12)
                .fontColor(Theme.COLOR_SUBTEXT)
                .width('100%')
              TextInput({ text: this.urlInput, placeholder: 'http://127.0.0.1:3080' })
                .width('100%')
                .height(44)
                .fontSize(14)
                .fontColor(Theme.COLOR_TEXT)
                .placeholderColor(Theme.COLOR_SUBTEXT)
                .backgroundColor(Theme.COLOR_SURFACE)
                .borderRadius(10)
                .onChange((value: string) => {
                  this.urlInput = value;
                })
              Text('· 本机使用：http://127.0.0.1:3080\n· 局域网使用：http://<鸿蒙电脑IP>:3080\n· 先运行 sh ~/bin/dsh-web.sh 启动服务')
                .fontSize(11)
                .fontColor(Theme.COLOR_SUBTEXT)
                .lineHeight(17)
                .width('100%')
            }
            .width('100%')

            // —— 服务端模型配置 ——
            Text('模型配置')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.COLOR_TEXT)
              .width('100%')

            Column({ space: 6 }) {
              Row({ space: 8 }) {
                Text(this.providerName.length > 0 ? this.providerName : '正在检测提供商…')
                  .fontSize(14)
                  .fontColor(Theme.COLOR_TEXT)
                  .layoutWeight(1)
                if (this.providerActive) {
                  Text('在线').fontSize(11).fontColor(Theme.COLOR_SUCCESS)
                } else if (this.providerName.length > 0) {
                  Text('离线').fontSize(11).fontColor(Theme.COLOR_ERROR)
                }
                if (this.apiKeySet) {
                  Text('✓ Key 已配置').fontSize(11).fontColor(Theme.COLOR_SUCCESS)
                } else if (this.providerName.length > 0) {
                  Text('✗ 未配置 Key').fontSize(11).fontColor(Theme.COLOR_WARNING)
                }
              }
              .width('100%')

              TextInput({ text: this.apiKeyInput, placeholder: 'DeepSeek API Key（sk-…）' })
                .width('100%')
                .height(44)
                .fontSize(14)
                .type(InputType.Password)
                .fontColor(Theme.COLOR_TEXT)
                .placeholderColor(Theme.COLOR_SUBTEXT)
                .backgroundColor(Theme.COLOR_SURFACE)
                .borderRadius(10)
                .onChange((value: string) => {
                  this.apiKeyInput = value;
                })
              Button('保存 API Key')
                .width('100%')
                .height(38)
                .fontSize(14)
                .backgroundColor(Theme.COLOR_SURFACE_HOVER)
                .fontColor(Theme.COLOR_TEXT)
                .borderRadius(10)
                .onClick(() => {
                  this.saveApiKey();
                })

              if (this.modelIds.length > 0) {
                Select(this.modelOptions)
                  .selected(this.modelIndex)
                  .value(this.currentModel.length > 0 ? this.currentModel : '选择模型')
                  .font({ size: 14 })
                  .fontColor(Theme.COLOR_TEXT)
                  .selectedOptionFont({ size: 14 })
                  .optionFont({ size: 14 })
                  .backgroundColor(Theme.COLOR_SURFACE)
                  .borderRadius(10)
                  .onSelect((index: number, value: string) => {
                    this.modelIndex = index;
                  })
                Button('保存模型')
                  .width('100%')
                  .height(38)
                  .fontSize(14)
                  .backgroundColor(Theme.COLOR_SURFACE_HOVER)
                  .fontColor(Theme.COLOR_TEXT)
                  .borderRadius(10)
                  .onClick(() => {
                    this.saveModel();
                  })
              }

              if (this.modelStatus.length > 0) {
                Text(this.modelStatus)
                  .fontSize(12)
                  .fontColor(Theme.COLOR_WARNING)
                  .width('100%')
              }
            }
            .width('100%')
            .padding(12)
            .backgroundColor(Theme.COLOR_SURFACE)
            .borderRadius(12)

            // —— 连接状态 + 保存重连 ——
            Row({ space: 8 }) {
              Circle({ width: 8, height: 8 })
                .fill(this.connected ? Theme.COLOR_SUCCESS : Theme.COLOR_ERROR)
              Text('状态：' + this.statusText)
                .fontSize(13)
                .fontColor(Theme.COLOR_TEXT)
            }
            .width('100%')

            Button('保存并重连')
              .width('100%')
              .height(42)
              .fontSize(15)
              .backgroundColor(Theme.COLOR_PRIMARY)
              .fontColor(Color.White)
              .borderRadius(10)
              .onClick(() => {
                this.onSave(this.urlInput.trim());
                this.onClose();
              })
          }

          // 鸿蒙底层适配：dsh 服务启动引导（对应本仓库 scripts/dsh-web.sh）
          Column({ space: 6 }) {
            Text('dsh 服务启动（在鸿蒙终端执行）')
              .fontSize(12)
              .fontColor(Theme.COLOR_SUBTEXT)
              .width('100%')
            Text('sh ~/bin/dsh-web.sh\n# node=/data/service/hnp/node.org/node_v24.13.0/bin/node\n# patch=harmony.patch.yml · 端口 3080')
              .fontSize(11)
              .fontFamily(Theme.FONT_MONO)
              .fontColor(Theme.COLOR_SUBTEXT)
              .lineHeight(17)
              .width('100%')
              .padding(10)
              .backgroundColor(Theme.COLOR_CODE_BG)
              .borderRadius(8)
          }
          .width('100%')

          Text('DeepSeek Harness 鸿蒙桌面客户端 v1.1.0')
            .fontSize(12)
            .fontColor(Theme.COLOR_SUBTEXT)
            .width('100%')
            .textAlign(TextAlign.Center)
          Text('内置直连 · dsh 服务双模式（HTTP RPC + SSE）')
            .fontSize(11)
            .fontColor(Theme.COLOR_SUBTEXT)
            .width('100%')
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .padding(20)
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.COLOR_BG)
  }
}
