# Avisos de terceros (Windows)

Nsound para Windows detecta el tono y el BPM de lo que suena, en local y sin enviar ni guardar audio.

## KeyFindTray (MIT)
Proyecto de «KeyFindTray contributors». De él se toma el modo de uso del modelo de tono (audio mono a 22 050 Hz, mínimo 3 s, 24 clases), la lista de ficheros del modelo con su revisión y sus huellas SHA-256 (`SKeyDetector.cs`), y la idea de analizar la salida del sistema por WASAPI «loopback».

```
MIT License
Copyright (c) 2026 KeyFindTray contributors
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
```
(El texto completo de la licencia está en el proyecto original, `LICENSE`.)

## S-KEY (Deezer, MIT) — `LibreStream.App/Assets/models/skey/`
Modelo de detección de tono de Deezer SA, exportado a ONNX en https://huggingface.co/aaatmy/skey-onnx (revisión `c04b6a2bc1d82e50b46d8669560d056f3a2344ab`, checkpoint `deezer/skey`). Se incluyen sus licencias: `LICENSE` (Deezer SA, MIT), `ConvNeXt-LICENSE` (MIT) y `nnAudio-LICENSE` (MIT). La app solo carga el modelo si su SHA-256 coincide con el fijado.

## ONNX Runtime (MIT)
`Microsoft.ML.OnnxRuntime` — Microsoft. Se desactiva su telemetría.

## NAudio (MIT)
`NAudio.Wasapi` — Mark Heath. Captura de la salida del sistema.

## No incluido
Los modelos «madmom» de KeyFindTray (ritmo, acordes y su segundo modelo de tono) son CC BY-NC-SA 4.0; no se usan. El BPM lo calcula un método propio (`KeyBpmAnalyzer`).
