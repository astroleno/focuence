# Third-party notices

Focuence 2.0 bundles the following public model/runtime assets for offline execution. Existing Focuence project copyright remains with its respective owners; this notice does not assign a new license to the original repository.

| Component | Version / source | License / included notice |
| --- | --- | --- |
| BGE-small-zh-v1.5 model | [BAAI model card](https://huggingface.co/BAAI/bge-small-zh-v1.5) | MIT, as declared in the model card; original FlagEmbedding notice in `licenses/FlagEmbedding-MIT.txt` |
| ONNX q8 conversion | [Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5), revision `75c43b069aac4d136ba6bc1122f995fedcfd2781` | Derived from BGE; conversion README and full file hashes in `models/bge-small-zh-v1.5/` and `model-lock.json` |
| Transformers.js | `@huggingface/transformers@3.8.1`, [official source](https://github.com/huggingface/transformers.js) | Apache-2.0; `licenses/transformers-js-Apache-2.0.txt` |
| Hugging Face Jinja | Locked dependency of Transformers.js | Apache-2.0; `licenses/jinja-Apache-2.0.txt` |
| ONNX Runtime Web | `1.22.0-dev.20250409-89f8206ba4`, [official source](https://github.com/microsoft/onnxruntime) | MIT; `licenses/onnxruntime-MIT.txt` and `licenses/onnxruntime-ThirdPartyNotices.txt` |
| esbuild | `0.28.2`, build-time dependency | MIT; not included as an extension runtime |

Generated JavaScript preserves legal comments. The runtime's third-party notices include licenses for its embedded dependencies. The application uses operating system fonts and locally drawn SVG interface icons; it does not request remote fonts or website favicons.

Model weights/tokenizer files are SHA-256 verified against `model-lock.json`. The ONNX model payload is **24,010,842 bytes** before archive compression. WASM runtime files are additional; model size is not the full installation size or runtime RAM usage.
