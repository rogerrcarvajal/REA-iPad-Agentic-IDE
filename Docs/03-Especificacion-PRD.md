# Especificación Funcional (PRD) — REA-iPad-Agentic-IDE
**Proyecto:** REA-iPad-Agentic-IDE  
**Fecha:** 2026-10-30  
**Versión:** 2.0.0

---

## 1. Declaración del Problema y Visión del Producto

### Problema
Los desarrolladores que utilizan iPad Pro con chip M2 disponen de una arquitectura de hardware extraordinaria (memoria unificada de 16GB, pantalla Liquid Retina ProMotion 120Hz, procesador de 8 núcleos de alto rendimiento), pero se encuentran limitados en el software:
- Las apps de la App Store tienen capacidades de IA nulas o limitadas a un simple chat de autocompletado de texto sin llamadas a modelos reales.
- VS Code Web oficial no tiene modo agente autónomo con ejecución sobre archivos ni integración con modelos Google Gemini / Ollama.
- La selección de directorios en iPadOS Safari no soporta la API Chromium `showDirectoryPicker()`, requiriendo un enfoque híbrido con `<input webkitdirectory>` y almacenamiento local persistente (IndexedDB/LightningFS) para clonación y edición.

### Visión
Desarrollar un IDE de última generación diseñado específicamente para el iPad Pro M2 que combine la precisión de edición de VS Code (Monaco Editor), la potencia multiagéntica autónoma (Gemini 2.5 Flash / Pro con cuenta Google o API key, streaming y contexto vivo) y herramientas operativas de Git y terminal.

---

## 2. Matriz de Requerimientos Funcionales Primarios (RF1 a RF5)

| ID | Módulo | Descripción Funcional | Estado |
|---|---|---|:---:|
| **RF1** | **Gestor de Carpetas y Sincronización Git** | Menú desplegable "Abrir Carpeta" con selección nativa en PC (`showDirectoryPicker`) o importador de carpetas en iPadOS Safari (`<input webkitdirectory>` soportado en iPadOS 18.4+). Integración completa con **isomorphic-git** en el navegador para `git clone`, `git pull`, `git status`, `git commit` y `git push` a través de un Smart-HTTP proxy seguro en el backend PHP (`api/git-proxy.php`). | **Completado (100%)** |
| **RF2** | **Guardado de Archivos y Documentación Viva** | Menú desplegable "Guardar" que permite:<br>1. Guardar el archivo abierto en Monaco (<kbd>⌘S</kbd> / <kbd>Ctrl+S</kbd>).<br>2. Generar y guardar el **Plan de Implementación** estructurado (`Docs/PLAN-<timestamp>.md`).<br>3. Generar y guardar el **Walkthrough** de cambios verificables (`Docs/WALKTHROUGH-<timestamp>.md`).<br>4. Exportar la conversación agéntica íntegra (`Docs/CHAT-<timestamp>.md`). | **Completado (100%)** |
| **RF3** | **Autenticación Google y Gestión de Modelos (Planes Free / Pro)** | Módulo de configuración ⚙️ y botón de Cuenta en cabecera. Soporta vinculación directa con **Cuenta Google** vía Google Identity Services (OAuth 2.0 Token Client) asociado al proyecto GCP (`x-goog-user-project`), así como entrada de **API Key de Google AI Studio** para planes gratuitos o de pago. Selector reactivo de modelos Gemini (2.5 Flash, 2.5 Pro, Flash-Lite) y modelos locales Ollama en LAN. | **Completado (100%)** |
| **RF4** | **Terminal de Doble Modo (Local & Puente CLI PC)** | Terminal virtual interactiva con dos modos operativos:<br>1. **Modo Local:** Comandos de workspace (`ls`, `cat`, `open`, `rm`, `pwd`, `ws`, `clear`), subcomandos Git (`git clone`, `pull`, `status`, `commit`, `push`, `log`), y llamadas CLI de IA (`ai <prompt>`, `models`).<br>2. **Modo PC (`pc`):** Puente de ejecución autenticado vía `api/terminal.php` en XAMPP para ejecutar herramientas reales instaladas en el PC host (`git`, `npm`, `gemini -p`, `ollama run`). | **Completado (100%)** |
| **RF5** | **Chat Interactivo Agéntico con Modelos Reales** | Panel Agéntico con streaming SSE token a token conectado al modelo seleccionado. Inyección automática del contexto vivo del proyecto (árbol de archivos, archivo activo en Monaco y texto seleccionado). Renderizado de Markdown con marked y DOMPurify, diagramas Mermaid interactivos y bloques de código con acciones rápidas: Copiar, Insertar en Monaco, o **Escribir directamente en el archivo del proyecto** (`path=...`). | **Completado (100%)** |

---

## 3. Historias de Usuario y Criterios de Aceptación (Gherkin)

### Escenario 1 (RF1): Clonar y sincronizar repositorio en iPad Safari
```gherkin
Dado que el desarrollador abre REA Agentic IDE en Safari en su iPad Pro M2
Cuando pulsa en "Abrir Carpeta" y selecciona "Clonar repositorio Git"
Y especifica la URL "https://github.com/rogerrcarvajal/REA-iPad-Agentic-IDE.git"
Entonces isomorphic-git descarga los objetos a través de api/git-proxy.php
Y crea un workspace persistente en IndexedDB (LightningFS)
Y renderiza el árbol de archivos en el explorador
Y al pulsar "Git Pull" se descargan las actualizaciones remotas sin recargar la página.
```

### Escenario 2 (RF2): Generación y persistencia de Plan y Walkthrough en Docs/
```gherkin
Dado que el desarrollador ha interactuado con el agente sobre una tarea de programación
Cuando pulsa el botón "Guardar" y selecciona "Guardar Plan → Docs/"
Entonces el agente procesa el contexto del proyecto y el historial
Y genera un documento Markdown estructurado con Objetivo, Cambios, Pasos de Ejecución y Verificación
Y lo escribe físicamente en "Docs/PLAN-YYYYMMDD_HHMM.md"
Y refresca el explorador de archivos abriendo el nuevo documento en una pestaña de Monaco.
```

### Escenario 3 (RF3 & RF5): Conexión con modelo Gemini y ejecución de código
```gherkin
Dado que el desarrollador ha configurado su API Key o cuenta Google en ⚙️ Cuenta
Y tiene seleccionado el modelo "Gemini 2.5 Flash"
Cuando envía una consulta solicitando refactorizar una función
Entonces la respuesta se transmite vía streaming en tiempo real
Y los bloques de código que indican ruta (ej. ```ts path=src/service.ts)
Muestran el botón "⚡ Escribir src/service.ts"
Y al pulsarlo, el archivo se actualiza en el workspace y en el editor Monaco activo.
```

### Escenario 4 (RF4): Terminal interactiva y modo PC
```gherkin
Dado que el desarrollador abre la terminal inferior
Cuando escribe "ai ¿cómo funciona el event loop en JS?"
Entonces la terminal consulta en streaming al modelo de IA y muestra la respuesta en consola
Y cuando escribe "pc git status"
Entonces la instrucción se ejecuta en el PC host vía api/terminal.php y muestra la salida real del sistema.
```
