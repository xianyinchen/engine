/*
 Copyright (c) 2019-2020 Xiamen Yaji Software Co., Ltd.

 https://www.cocos.com/

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated engine source code (the "Software"), a limited,
  worldwide, royalty-free, non-assignable, revocable and non-exclusive license
 to use Cocos Creator solely to develop games on your target platforms. You shall
  not use Cocos Creator software for developing other software or tools that's
  used for developing games. You are not granted to publish, distribute,
  sublicense, and/or sell copies of Cocos Creator.

 The software or tools in this License Agreement are licensed, not sold.
 Xiamen Yaji Software Co., Ltd. reserves all rights not expressly granted to you.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

import { EDITOR } from 'internal:constants';
import { CompleteCallback, IXHROptions } from './shared';

type FileProgressCallback = (loaded: number, total: number) => void;

export default function downloadFile(
    url: string,
    options: IXHROptions,
    onProgress: FileProgressCallback | null | undefined,
    onComplete: CompleteCallback,
) {
    if (EDITOR) {
        const xhr = new XMLHttpRequest();
        const errInfo = `download failed: ${url}, status: `;

        xhr.open('GET', url, true);

        if (options.xhrResponseType !== undefined) { xhr.responseType = options.xhrResponseType; }
        if (options.xhrWithCredentials !== undefined) { xhr.withCredentials = options.xhrWithCredentials; }
        if (options.xhrMimeType !== undefined && xhr.overrideMimeType) { xhr.overrideMimeType(options.xhrMimeType); }
        if (options.xhrTimeout !== undefined) { xhr.timeout = options.xhrTimeout; }

        if (options.xhrHeader) {
            for (const header in options.xhrHeader) {
                xhr.setRequestHeader(header, options.xhrHeader[header]);
            }
        }

        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 0) {
                if (onComplete) { onComplete(null, xhr.response); }
            } else if (onComplete) { onComplete(new Error(`${errInfo}${xhr.status}(no response)`)); }
        };

        if (onProgress) {
            xhr.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(e.loaded, e.total);
                }
            };
        }

        xhr.onerror = (ev) => {
            if (onComplete) { onComplete(new Error(`${errInfo}${xhr.status}(error)`)); }
        };

        xhr.ontimeout = () => {
            if (onComplete) { onComplete(new Error(`${errInfo}${xhr.status}(time out)`)); }
        };

        xhr.onabort = () => {
            if (onComplete) { onComplete(new Error(`${errInfo}${xhr.status}(abort)`)); }
        };

        xhr.send(null);
    }
    else {
        const errInfo = `download failed: ${url}, status: `;

        fetch(url, { method: 'GET' }).then(function (response) {
            if (response.status >= 200 && response.status < 300) {
                return Promise.resolve(response)
            } else {
                return Promise.reject(new Error(response.statusText))
            }
        }).then(async function (response) {
            if (!onProgress) {
                return Promise.resolve(response)
            }

            const total = Number(response.headers.get('content-length'));
            const reader = response.body!.getReader();
            let bytesReceived = 0;
            while (true) {
                const result = await reader.read();
                if (result.done) {
                    console.log('Fetch complete');
                    break;
                }
                bytesReceived += result.value.length;
                onProgress(bytesReceived, total);
            }
            return Promise.resolve(response)
        }).then(function (response) {
            if (options.xhrResponseType == 'text') return response.text();
            if (options.xhrResponseType == 'blob') return response.blob();
            if (options.xhrResponseType == 'json') return response.json();
            if (options.xhrResponseType == 'arraybuffer') return response.arrayBuffer();
        }).then(function (data) {
            if (onComplete) { onComplete(null, data); }
        }).catch(function (error) {
            if (onComplete) { onComplete(new Error(`${errInfo} ${error} (error)`)); }
        });
    }
}
