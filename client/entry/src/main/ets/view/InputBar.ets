/**
 * InputBar：底部输入栏（多行输入 + 发送/停止）。
 * 参照华为开发者文档《文本输入 (TextInput/TextArea)》：TextArea 多行输入，
 * enterKeyType + onSubmit 实现回车发送。
 */
import { Theme } from '../common/Theme';
import { KeyCode } from '@kit.InputKit';

@Component
export struct InputBar {
  @Prop streaming: boolean = false;
  @Prop connected: boolean = false;
  onSend: (text: string) => void = () => {};
  onStop: () => void = () => {};
  @State input: string = '';

  build() {
    Row({ space: 10 }) {
      TextArea({ text: this.input, placeholder: this.placeholderText() })
        .width('100%')
        .layoutWeight(1)
        .height(96)
        .fontSize(15)
        .fontColor(Theme.COLOR_TEXT)
        .placeholderFont({ size: 14 })
        .placeholderColor(Theme.COLOR_SUBTEXT)
        .backgroundColor(Theme.COLOR_SURFACE)
        .borderRadius(12)
        .padding(12)
        .onChange((value: string) => {
          this.input = value;
        })
        .onKeyEvent((event: KeyEvent) => {
          // 回车发送（参照华为开发者文档《按键事件》）
          if (event.type === KeyType.Down && event.keyCode === KeyCode.KEYCODE_ENTER) {
            this.doSend();
          }
        })
      Column({ space: 8 }) {
        if (this.streaming) {
          Button('停止')
            .width(88)
            .height(40)
            .fontSize(14)
            .backgroundColor(Theme.COLOR_ERROR)
            .fontColor(Color.White)
            .borderRadius(10)
            .onClick(() => {
              this.onStop();
            })
        } else {
          Button('发送')
            .width(88)
            .height(40)
            .fontSize(14)
            .backgroundColor(this.connected ? Theme.COLOR_PRIMARY : Theme.COLOR_SURFACE)
            .fontColor(this.connected ? Color.White : Theme.COLOR_SUBTEXT)
            .borderRadius(10)
            .onClick(() => {
              this.doSend();
            })
        }
        Text('Enter 发送')
          .fontSize(10)
          .fontColor(Theme.COLOR_SUBTEXT)
      }
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 12, bottom: 16 })
    .border({ width: { top: 1 }, color: Theme.COLOR_BORDER })
    .backgroundColor(Theme.COLOR_BG)
  }

  private placeholderText(): string {
    if (!this.connected) {
      return '未连接，请先在设置中配置 dsh 服务地址';
    }
    return this.streaming ? '正在生成…' : '输入消息，Enter 发送';
  }

  private doSend(): void {
    const text: string = this.input.trim();
    if (text.length === 0 || this.streaming || !this.connected) {
      return;
    }
    this.onSend(text);
    this.input = '';
  }
}
