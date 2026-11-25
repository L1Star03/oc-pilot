import { webview } from '@kit.ArkWeb';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  @State url: string = 'https://laptop-3ekji6v6.tail01cb1b.ts.net';
  @State errShow: boolean = false;
  urlList: string[] = ['https://laptop-3ekji6v6.tail01cb1b.ts.net', 'http://10.10.147.21:4097', 'http://100.87.84.93:4097'];
  urlIdx: number = 0;

  aboutToAppear() {
    webview.WebviewController.initializeWebEngine();
  }

  build() {
    Column() {
      if (this.errShow) {
        Column({ space: 14 }) {
          Text('无法连接服务器')
            .fontSize(20).fontColor('#cccccc')
          Text('点重试切换线路')
            .fontSize(13).fontColor('#8f8f8f')
          Button('重试')
            .width(140).height(44).backgroundColor('#0e639c').fontColor('#ffffff')
            .onClick(() => {
              this.errShow = false;
              this.urlIdx = (this.urlIdx + 1) % this.urlList.length;
              this.url = this.urlList[this.urlIdx];
              try { this.controller.loadUrl(this.url); } catch (e) {}
            })
        }
        .width('100%').height('100%').justifyContent(FlexAlign.Center)
        .backgroundColor('#1e1e1e')
      } else {
        Web({ src: this.url, controller: this.controller })
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .databaseAccess(true)
          .fileAccess(true)
          .onControllerAttached(() => {
            try { this.controller.loadUrl(this.url); } catch (e) {}
          })
          .onErrorReceive((event) => {
            if (event && event.error && event.request && event.request.isMainFrame()) {
              this.errShow = true;
            }
          })
          .onDownloadStart((event) => {
            try { this.controller.loadUrl(event.url); } catch (e) {}
          })
          .width('100%')
          .height('100%')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#1e1e1e')
  }
}
