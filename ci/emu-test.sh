#!/usr/bin/env bash
# Prueba en el emulador (Android de fábrica, sin capa de fabricante): abre Ajustes, enseña el apartado «Música en segundo plano»,
# prueba el segundo plano / pantalla apagada y recoge capturas y registro. Cada orden tiene límite de tiempo.
set -u
OUT=emu-out; mkdir -p "$OUT"
P() { echo "$(date +%T) $*" | tee -a "$OUT/progreso.txt"; }
A() { timeout 90 adb "$@"; }
SHOT() { timeout 60 adb exec-out screencap -p > "$OUT/$1" 2>/dev/null || P "captura $1 falló"; P "captura $1"; }
APK=android/app/build/outputs/apk/debug/app-debug.apk
P "instalar"; A install -r "$APK" 2>&1 | tee "$OUT/install.txt"
A logcat -c
A shell pm grant org.librestream.app android.permission.POST_NOTIFICATIONS 2>/dev/null
P "abrir en Ajustes"; A shell am start -n org.librestream.app/.MainActivity --es route settings 2>&1 | tee "$OUT/start.txt"
sleep 30; SHOT 1-ajustes.png
for i in 1 2 3 4 5 6; do A shell input swipe 540 1900 540 500 300; sleep 1; done
sleep 2; SHOT 2-segundo-plano.png
for i in 1 2; do A shell input swipe 540 1900 540 500 300; sleep 1; done; SHOT 3-mas-abajo.png
P "segundo plano"; A shell input keyevent 3; sleep 8; SHOT 4-fuera.png
P "volver"; A shell am start -n org.librestream.app/.MainActivity; sleep 8
P "pantalla apagada y encendida"; A shell input keyevent 26; sleep 5; A shell input keyevent 26; sleep 3; A shell input keyevent 82; sleep 4; SHOT 5-pantalla.png
A logcat -d > "$OUT/logcat.txt" 2>&1
grep -iE "chromium|console|Uncaught|FATAL|AndroidRuntime|org.librestream" "$OUT/logcat.txt" | tail -80 > "$OUT/resumen-log.txt"
A shell run-as org.librestream.app cat files/bglog.txt > "$OUT/bglog.txt" 2>&1 || P "no se pudo leer bglog.txt (APK sin depuración)"
A shell pidof org.librestream.app > "$OUT/pid.txt" 2>&1 || echo "SIN PROCESO (se cerró)" > "$OUT/pid.txt"
P "fin"
