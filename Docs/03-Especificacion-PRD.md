# Especificación Funcional (PRD) - REA-iPad-Agentic-IDE
**Proyecto:** REA-iPad-Agentic-IDE  
**Fecha:** 2026-10-30  
**Versión:** 1.0.0

---

## 1. Declaración del Problema y Visión del Producto

### Problema
Los desarrolladores que utilizan iPad Pro con chip M2 disponen de una arquitectura de hardware extraordinaria (memoria unificada de 16GB, pantalla Liquid Retina ProMotion 120Hz, procesador de 8 núcleos de alto rendimiento), pero se encuentran limitados en el software:
- Las apps de la App Store tienen capacidades de IA nulas o limitadas a un simple chat de autocompletado de texto.
- VS Code Web oficial no tiene modo agente autónomo ni integración nativa con MCP.
- Los atajos de teclado estándar chocan con iPadOS y escribir símbolos de código en pantalla es engorroso.

### Visión
Desarrollar un IDE de última generación diseñado específicamente para el iPad Pro M2 que combine la precisión de edición de VS Code, la potencia multiagéntica autónoma de Antigravity (planificación, ejecución por pasos, living artifacts) y una ergonomía táctil optimizada para movilidad.

---

## 2. Requerimientos Funcionales (FR)

| ID | Módulo | Descripción | Prioridad |
|---|---|---|:---:|
| **FR-01** | **Editor** | Integración de Monaco Editor con soporte para JS/TS, Python, HTML/CSS, JSON, Markdown, Rust, Go y C++. | Must |
| **FR-02** | **File System** | Apertura y edición directa de carpetas locales del iPad/PC usando la File System Access API (`showDirectoryPicker`) sin subir archivos a servidores intermedios. | Must |
| **FR-03** | **Modo Agente** | Panel Agéntico con selector de modelos (Gemini 2.5 Flash, Gemini Pro, Argon, Local Ollama), streaming de respuesta y ejecución autónoma. | Must |
| **FR-04** | **Living Artifacts** | Renderizado en tiempo real de diagramas Mermaid, previsualizaciones interactivas HTML y reportes estructurados. | Must |
| **FR-05** | **Protocolo MCP** | Conexión con servidores MCP para invocar herramientas externas (GitHub, lectura de archivos, bases de datos). | Should |
| **FR-06** | **Barra Táctil** | Barra flotante de modificadores y caracteres especiales para iPad (`Esc`, `Tab`, `Ctrl`, `Alt`, `Cmd`, `{`, `}`, `[`, `]`, `|`, `~`, flechas). | Must |
| **FR-07** | **PWA Standalone** | Manifiesto y Service Worker para instalación en la pantalla de inicio de iPadOS en modo pantalla completa sin barra de navegación del navegador. | Must |
| **FR-08** | **Terminal Virtual** | Terminal virtual interactiva para ejecutar comandos de proyecto y evaluación rápida de código en JavaScript/Wasm. | Should |

---

## 3. Historias de Usuario con Criterios de Aceptación (Gherkin)

### Escenario 1: Apertura de una carpeta de proyecto local
```gherkin
Dado que el desarrollador abre REA-iPad-Agentic-IDE en Safari del iPad Pro
Cuando pulsa en el botón "Abrir Carpeta" del explorador
Entonces se despliega el selector nativo de carpetas de iPadOS
Y tras conceder permiso, el explorador renderiza el árbol reactivo de archivos y subdirectorios
Y permite abrir cualquier archivo en pestañas dentro de Monaco Editor
```

### Escenario 2: Solicitud de refactorización al Agente Antigravity
```gherkin
Dado que el desarrollador tiene un archivo de código abierto en el editor
Cuando abre el panel del Agente y escribe "Refactoriza esta función aplicando Clean Code y dibuja el flujo en Mermaid"
Entonces el agente planifica la tarea, genera la versión refactorizada
Y actualiza el archivo en el editor
Y presenta un Living Artifact con el diagrama Mermaid renderizado
```

### Escenario 3: Uso de la barra de modificadores táctil en iPad
```gherkin
Dado que el desarrollador está editando código en modo tablet sin teclado físico
Cuando pulsa el botón `{` o `Tab` en la barra flotante inferior
Entonces se inserta de inmediato el carácter correspondiente en la posición actual del cursor de Monaco Editor
Sin perder el foco de edición
```
