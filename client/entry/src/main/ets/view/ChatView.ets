/**
 * ChatView：聊天主区（顶部栏 + 消息列表 + 输入栏）。
 * 参照华为开发者文档《列表 (List/ListItem)》：List + ForEach 渲染消息，
 * Scroller 控制滚动到底部。
 */
import { Theme } from '../common/Theme';
import { ChatMessage } from '../model/Types';
import { MessageItem } from './MessageItem';
import { InputBar } from './InputBar';

@Component
export struct ChatView {
  @Prop title: string = '';
  @Link messages: ChatMessage[];
  @Prop streaming: boolean = false;
  @Prop connected: boolean = false;
  @Prop directMode: boolean = false;
  scroller: Scroller = new Scroller();
  onSend: (text: string) => void = () => {};
  onStop: () => void = () => {};

  build() {
    Column() {
      // 顶部栏
      Row({ space: 12 }) {
        Text(this.title.length > 0 ? this.title : '新会话')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.COLOR_TEXT)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (this.streaming) {
          Button('停止生成')
            .height(30)
            .fontSize(12)
            .backgroundColor(Theme.COLOR_ERROR)
            .fontColor(Color.White)
            .borderRadius(15)
            .onClick(() => {
              this.onStop();
            })
        } else if (!this.connected) {
          Text('未连接')
            .fontSize(12)
            .fontColor(Theme.COLOR_ERROR)
        }
      }
      .width('100%')
      .height(56)
      .padding({ left: 20, right: 20 })
      .border({ width: { bottom: 1 }, color: Theme.COLOR_BORDER })
      .backgroundColor(Theme.COLOR_BG)

      // 消息区
      if (this.messages.length === 0) {
        this.emptyState()
      } else {
        List({ space: 14, scroller: this.scroller }) {
          ForEach(this.messages, (msg: ChatMessage) => {
            ListItem() {
              MessageItem({ message: msg })
            }
          }, (msg: ChatMessage) => msg.id)
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 20, right: 20, top: 16, bottom: 16 })
        .scrollBar(BarState.Off)
      }

      // 输入栏
      InputBar({
        streaming: this.streaming,
        connected: this.connected,
        onSend: (text: string) => {
          this.onSend(text);
        },
        onStop: () => {
          this.onStop();
        }
      })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.COLOR_BG)
  }

  @Builder
  emptyState() {
    Column({ space: 12 }) {
      Image($r('app.media.icon'))
        .width(72)
        .height(72)
        .opacity(0.85)
        .borderRadius(20)
      Text('DeepSeek Harness')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(Theme.COLOR_TEXT)
      Text(this.directMode ? '内置直连 · 打开即用' : '连接本机或局域网的 dsh 服务，开始对话')
        .fontSize(13)
        .fontColor(Theme.COLOR_SUBTEXT)
      Text(this.directMode ? '在「设置」中填写 API Key 即可开始' :
        (this.connected ? '已连接' : '未连接，请在「设置」中配置服务器地址'))
        .fontSize(12)
        .fontColor(this.connected ? Theme.COLOR_SUCCESS : Theme.COLOR_WARNING)
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
  }
}
