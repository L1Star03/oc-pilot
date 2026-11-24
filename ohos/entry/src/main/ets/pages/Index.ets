import { webview } from '@kit.ArkWeb';

const URLS: string[] = ['https://laptop-3ekji6v6.tail01cb1b.ts.net', 'http://10.10.147.21:4097', 'http://100.87.84.93:4097'];

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  @State urlIdx: number = 0;
  @State url: string = URLS[0];
  @State errShow: boolean = false;
  @State triedAll: boolean = false;

  build() {
    Column() {
      if (this.errShow) {
        Column({ space: 14 }) {
          Text('无法连接服务器')
            .fontSize(20).fontColor('#cccccc')
          Text('检查电脑端 oc-pilot 服务与网络')
            .fontSize(13).fontColor('#8f8f8f')
          Button('重试')
            .width(140).height(44).backgroundColor('#0e639c').fontColor('#ffffff')
            .onClick(() => {
              this.errShow = false;
              this.urlIdx = (this.urlIdx + 1) % URLS.length;
              this.url = URLS[this.urlIdx];
              this.controller.loadUrl(this.url);
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
          .mixedMode(MixedMode.All)
          .onErrorReceive((event) => {
            if (event && event.error && event.error.getErrorInfo() && event.request && event.request.isMainFrame()) {
              this.errShow = true;
            }
          })
          .onDownloadStart((event) => {
            try {
              this.controller.loadUrl(event.url);
            } catch (e) {}
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
