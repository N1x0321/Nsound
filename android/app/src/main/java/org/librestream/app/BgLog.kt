package org.librestream.app

import java.io.File
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * Registro corto de lo que pasa con la música en segundo plano (pantalla apagada, servicio, página, reproductor), para poder ver
 * por qué se para en un móvil concreto. Solo se guarda en el propio móvil; el usuario lo copia y lo envía si quiere.
 */
object BgLog {
    private const val MAX = 250
    private val lines = ArrayDeque<String>()
    private var file: File? = null
    private val fmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    fun init(dir: File) {
        if (file != null) return
        file = File(dir, "bglog.txt")
        try { file?.takeIf { it.exists() }?.readLines()?.takeLast(MAX)?.forEach { lines.addLast(it) } } catch (_: Exception) { /* sin registro previo */ }
    }

    @Synchronized
    fun add(tag: String, msg: String) {
        val line = "${fmt.format(Date())} [$tag] $msg"
        lines.addLast(line)
        while (lines.size > MAX) lines.removeFirst()
        try { file?.appendText(line + "\n") } catch (_: Exception) { /* sin espacio: se queda en memoria */ }
    }

    @Synchronized
    fun dump(): String = lines.joinToString("\n")

    @Synchronized
    fun clear() {
        lines.clear()
        try { file?.writeText("") } catch (_: Exception) { /* nada */ }
    }
}
