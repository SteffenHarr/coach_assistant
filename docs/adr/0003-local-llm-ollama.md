# ADR 0003: Lokales LLM via Ollama

**Status:** Accepted
**Date:** 2026-05-11

## Context

Der Coach Assistant soll einen konversationellen Agenten enthalten.
Anforderungen:

- Open Source, keine kostenpflichtigen Cloud-Dienste.
- Personenbezogene Daten dürfen den Server nicht verlassen.
- Tool-Calling muss unterstützt werden (für strukturierte Aktionen).

## Decision

Wir verwenden **Ollama** als lokalen Modell-Server (MIT-Lizenz) mit
Modellen wie `llama3.1:8b-instruct` oder `qwen2.5:7b-instruct`. Die
Agent-Logik nutzt **LangGraph** (`create_react_agent`) mit dem
Adapter `langchain-ollama`.

Die Tool-Calls des Agents adressieren ausschließlich unsere eigenen
REST-Endpunkte — der Agent wird so zu einer Konversations-Schicht
**über** der bestehenden API.

Schreibende Aktionen erfordern explizite Bestätigung
(`AGENT_REQUIRE_CONFIRMATION=true`). Alle Tool-Calls werden im
Audit-Log persistiert.

## Consequences

- ➕ DSGVO-freundlich: keine Übermittlung personenbezogener Daten an Dritte.
- ➕ Keine laufenden Kosten.
- ➕ Modell jederzeit austauschbar via `OLLAMA_MODEL`.
- ➖ Lokale GPU/CPU-Ressourcen erforderlich (8B-Modell läuft auf 16 GB RAM).
- ➖ Antwort-Qualität geringer als bei großen Cloud-Modellen — für
  unseren Use Case (strukturierte Tool-Calls + kurze Erklärungen)
  jedoch ausreichend.
