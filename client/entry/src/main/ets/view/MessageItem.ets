/**
 * MessageItem：单条消息渲染（用户气泡 / 助手消息 / 工具卡片）。
 * 参照华为开发者文档《@Observed 和 @ObjectLink》：@ObjectLink 观察
 * @Observed 类实例的属性变化，实现流式输出逐字刷新。
 */
import { Theme } from '../common/Theme';
import { ChatMessage, TextBlock } from '../model/Types';

@Component
export struct MessageItem {
  @ObjectLink message: ChatMessage;

  build() {
    Column() {
      if (this.message.role === 'user') {
        this.userBubble()
      } else if (this.message.role === 'tool') {
        this.toolCard()
      } else {
        this.assistantBlock()
      }
    }
    .width('100%')
  }

  @Builder
  userBubble() {
    Row() {
      Blank()
      Text(this.message.text)
        .fontSize(Theme.FONT_BODY)
        .fontColor(Color.White)
        .lineHeight(22)
        .padding({ left: 16, right: 16, top: 10, bottom: 10 })
        .backgroundColor(Theme.COLOR_USER_BUBBLE)
        .borderRadius({ topLeft: 16, topRight: 16, bottomLeft: 16, bottomRight: 4 })
        .constraintSize({ maxWidth: '70%' })
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  assistantBlock() {
    Row({ space: 10 }) {
      Image($r('app.media.icon'))
        .width(30)
        .height(30)
        .borderRadius(8)
      Column({ space: 6 }) {
        if (this.message.reasoning.length > 0) {
          Text('思考中…')
            .fontSize(12)
            .fontColor(Theme.COLOR_SUBTEXT)
        }
        ForEach(this.splitBlocks(this.message.text), (block: TextBlock, index: number) => {
          if (block.isCode) {
            Text(block.text)
              .fontSize(13)
              .fontFamily(Theme.FONT_MONO)
              .fontColor(Theme.COLOR_TEXT)
              .lineHeight(20)
              .padding(10)
              .width('100%')
              .backgroundColor(Theme.COLOR_CODE_BG)
              .borderRadius(8)
              .copyOption(CopyOptions.LocalDevice)
          } else {
            Text(block.text)
              .fontSize(Theme.FONT_BODY)
              .fontColor(Theme.COLOR_TEXT)
              .lineHeight(23)
              .copyOption(CopyOptions.LocalDevice)
          }
        }, (block: TextBlock, index: number) => index.toString())
        if (this.message.status === 'streaming') {
          Text('▍')
            .fontSize(Theme.FONT_BODY)
            .fontColor(Theme.COLOR_PRIMARY)
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  toolCard() {
    Row({ space: 8 }) {
      Text(this.message.status === 'running' ? '🔧' :
        (this.message.status === 'error' ? '❌' : '✅'))
        .fontSize(13)
      Column({ space: 3 }) {
        Text(this.message.toolName)
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.COLOR_TEXT)
        if (this.message.toolArgs.length > 0) {
          Text(this.message.toolArgs)
            .fontSize(11)
            .fontFamily(Theme.FONT_MONO)
            .fontColor(Theme.COLOR_SUBTEXT)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding(10)
    .backgroundColor(Theme.COLOR_SURFACE)
    .borderRadius(8)
    .border({ width: 1, color: Theme.COLOR_BORDER })
  }

  /**
   * 轻量 Markdown 处理：将 ``` 包裹的代码块与普通文本拆分为渲染块
   */
  private splitBlocks(text: string): TextBlock[] {
    const blocks: TextBlock[] = [];
    if (text.length === 0) {
      blocks.push(new TextBlock('', false));
      return blocks;
    }
    let remaining: string = text;
    while (remaining.length > 0) {
      const marker: number = remaining.indexOf('```');
      if (marker === -1) {
        blocks.push(new TextBlock(remaining, false));
        break;
      }
      if (marker > 0) {
        blocks.push(new TextBlock(remaining.slice(0, marker), false));
      }
      const end: number = remaining.indexOf('```', marker + 3);
      if (end === -1) {
        blocks.push(new TextBlock(remaining.slice(marker), false));
        break;
      }
      let code: string = remaining.slice(marker + 3, end);
      const nl: number = code.indexOf('\n');
      if (nl !== -1) {
        const lang: string = code.slice(0, nl).trim();
        if (lang.length > 0 && !lang.includes(' ')) {
          code = code.slice(nl + 1);
        }
      }
      blocks.push(new TextBlock(code, true));
      remaining = remaining.slice(end + 3);
    }
    return blocks;
  }
}
