import { UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: object): void {
    hilog.info(0x0000, 'ocpilot', 'ability onCreate');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(0x0000, 'ocpilot', 'loadContent failed');
        return;
      }
      try {
        let win = windowStage.getMainWindowSync();
        win.setWindowLayoutFullScreen(true);
      } catch (e) {
        hilog.error(0x0000, 'ocpilot', 'fullscreen failed');
      }
    });
  }
}
