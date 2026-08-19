/**
 * Sidebar：左侧栏（品牌区 + 新建会话 + 会话列表 + 连接状态/设置入口）。
 * 参照华为开发者文档《自定义组件》：@Link 与父组件 @State 双向同步，
 * @Prop 单向同步，普通函数属性作为事件回调（事件上抛）。
 */
import { Theme } from '../common/Theme';
import { DshSession } from '../model/Types';

@Component
export struct Sidebar {
  @Link sessions: DshSession[];
  @Prop currentSessionId: string = '';
  @Prop connected: boolean = false;
  @Prop statusText: string = '';
  @Prop directMode: boolean = false;
  onSelect: (id: string) => void = () => {};
  onNew: () => void = () => {};
  onSettings: () => void = () => {};

  build() {
    Column() {
      // 品牌区
      Row({ space: 10 }) {
        Image($r('app.media.icon'))
          .width(34)
          .height(34)
          .borderRadius(9)
        Column({ space: 2 }) {
          Text('DeepSeek Harness')
            .fontSize(15)
            .fontWeight(FontWeight.Bold)
            .fontColor(Theme.COLOR_TEXT)
          Text('桌面客户端')
            .fontSize(11)
            .fontColor(Theme.COLOR_SUBTEXT)
        }
        Blank()
        this.connDot()
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 14, bottom: 14 })

      // 新建会话
      Button('＋ 新建会话')
        .width('calc(100% - 32vp)')
        .height(38)
        .fontSize(14)
        .fontColor(Color.White)
        .backgroundColor(Theme.COLOR_PRIMARY)
        .borderRadius(10)
        .margin({ left: 16, right: 16, bottom: 10 })
        .onClick(() => {
          this.onNew();
        })

      // 会话列表
      Text('会话')
        .fontSize(12)
        .fontColor(Theme.COLOR_SUBTEXT)
        .width('100%')
        .padding({ left: 20, bottom: 6 })
      if (this.directMode) {
        // 内置直连模式：单会话工作区（打开即用）
        List({ space: 4 }) {
          ListItem() {
            Row({ space: 8 }) {
              Column({ space: 3 }) {
                Row({ space: 6 }) {
                  Text('本机会话（直连）')
                    .fontSize(14)
                    .fontColor(Theme.COLOR_TEXT)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                  Circle({ width: 6, height: 6 })
                    .fill(Theme.COLOR_PRIMARY)
                }
                .width('100%')
                Text('本地保存 · 打开即用')
                  .fontSize(11)
                  .fontColor(Theme.COLOR_SUBTEXT)
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
            }
            .width('100%')
            .padding({ left: 12, right: 12, top: 10, bottom: 10 })
            .borderRadius(10)
            .backgroundColor(Theme.COLOR_SURFACE_HOVER)
          }
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 10, right: 10 })
        .scrollBar(BarState.Off)
      } else {
        List({ space: 4 }) {
          ForEach(this.sessions, (item: DshSession) => {
            ListItem() {
              this.sessionRow(item)
            }
          }, (item: DshSession) => item.sessionId)
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 10, right: 10 })
        .scrollBar(BarState.Off)
      }

      // 底部：连接状态 + 设置
      Row({ space: 8 }) {
        this.connDot()
        Text(this.statusText)
          .fontSize(12)
          .fontColor(Theme.COLOR_SUBTEXT)
        Blank()
        Button('设置')
          .height(32)
          .fontSize(13)
          .backgroundColor(Theme.COLOR_SURFACE)
          .fontColor(Theme.COLOR_TEXT)
          .borderRadius(8)
          .onClick(() => {
            this.onSettings();
          })
      }
      .width('100%')
      .padding(12)
      .border({ width: { top: 1 }, color: Theme.COLOR_BORDER })
    }
    .width(280)
    .height('100%')
    .backgroundColor(Theme.COLOR_SIDEBAR)
  }

  @Builder
  connDot() {
    Circle({ width: 8, height: 8 })
      .fill(this.connected ? Theme.COLOR_SUCCESS : Theme.COLOR_ERROR)
  }

  @Builder
  sessionRow(item: DshSession) {
    Row({ space: 8 }) {
      Column({ space: 3 }) {
        Row({ space: 6 }) {
          Text(item.title.length > 0 ? item.title : '新会话')
            .fontSize(14)
            .fontColor(Theme.COLOR_TEXT)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          if (item.running) {
            Circle({ width: 6, height: 6 })
              .fill(Theme.COLOR_WARNING)
          }
        }
        .width('100%')
        Text(this.timeLabel(item.updatedAt))
          .fontSize(11)
          .fontColor(Theme.COLOR_SUBTEXT)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 10, bottom: 10 })
    .borderRadius(10)
    .backgroundColor(item.sessionId === this.currentSessionId ? Theme.COLOR_SURFACE_HOVER : Color.Transparent)
    .onClick(() => {
      this.onSelect(item.sessionId);
    })
  }

  private timeLabel(ts: number): string {
    if (ts <= 0) {
      return '';
    }
    const d: Date = new Date(ts);
    const now: Date = new Date();
    const pad = (n: number): string => {
      return n < 10 ? '0' + n.toString() : n.toString();
    };
    if (d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()) {
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    return (d.getMonth() + 1).toString() + '/' + d.getDate().toString();
  }
}
