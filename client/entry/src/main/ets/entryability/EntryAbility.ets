/**
 * EntryAbility：应用入口 Ability（Stage 模型）。
 * 参照华为开发者文档《Ability 开发》：
 * - UIAbility 是包含 UI 界面的 Ability，用于与用户交互
 * - onWindowStageCreate 中通过 loadContent 加载首页，并在此配置桌面窗口
 */
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const DOMAIN: number = 0x0000;
const TAG: string = 'DshEntryAbility';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onCreate');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // 加载主页面（main_pages.json 中注册的 pages/Index）
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, TAG, 'Succeeded in loading the content.');

      // 桌面（2in1）窗口适配：设置默认窗口尺寸与最小尺寸
      windowStage.getMainWindow((winErr, mainWindow) => {
        if (winErr.code) {
          hilog.warn(DOMAIN, TAG, 'getMainWindow failed. Cause: %{public}s', JSON.stringify(winErr));
          return;
        }
        try {
          mainWindow.setWindowLayoutFullScreen(false);
          mainWindow.resize(1200, 800);
        } catch (e) {
          hilog.warn(DOMAIN, TAG, 'resize window failed: %{public}s', String(e));
        }
      });
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, '%{public}s', 'Ability onBackground');
  }
}
