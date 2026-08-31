export interface AITaskDraft {
  description: string;
  criteria: Array<{ text: string; completed: boolean }>;
}

async function queryOllama(prompt: string, systemPrompt = 'Ты AI-помощник разработчика. Отвечай лаконично на русском языке.'): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3:latest',
        prompt: `${systemPrompt}\n\n${prompt}`,
        stream: false
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data.response) {
        return data.response.trim();
      }
    }
  } catch (e) {
    // Ollama not running or timeout
  }
  return null;
}

export async function generateTaskDraft(title: string): Promise<AITaskDraft> {
  const cleanTitle = title.trim();

  // Try Ollama first
  const prompt = `Сгенерируй краткое техническое описание и 4 критерия приемки (Acceptance Criteria) для задачи: "${cleanTitle}". 
Формат ответа:
Описание: <текст описания>
Критерии:
- [ ] <критерий 1>
- [ ] <критерий 2>
- [ ] <критерий 3>
- [ ] <критерий 4>`;

  const aiResponse = await queryOllama(prompt);

  if (aiResponse) {
    const lines = aiResponse.split('\n');
    let desc = '';
    const criteria: Array<{ text: string; completed: boolean }> = [];

    let inCriteria = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.toLowerCase().startsWith('критерии:')) {
        inCriteria = true;
        continue;
      }
      if (inCriteria) {
        const match = trimmed.match(/^-\s*\[[ xX]?\]\s*(.+)$/);
        if (match) {
          criteria.push({ text: match[1].trim(), completed: false });
        }
      } else if (trimmed.toLowerCase().startsWith('описание:')) {
        desc = trimmed.replace(/^описание:\s*/i, '');
      } else if (!inCriteria && trimmed) {
        desc += (desc ? '\n' : '') + trimmed;
      }
    }

    if (criteria.length > 0) {
      return {
        description: desc || `Реализовать функционал для: ${cleanTitle}.`,
        criteria
      };
    }
  }

  // High quality heuristic template
  return {
    description: `Реализация функционала: "${cleanTitle}". Включает разработку UI-компонентов, интеграцию с сервисами данных и валидацию корректности работы.`,
    criteria: [
      { text: `Разработка интерфейса и отображение основных элементов для "${cleanTitle}"`, completed: false },
      { text: 'Интеграция с API и хранилищем состояния приложения', completed: false },
      { text: 'Обработка граничных состояний, ошибок и пустого состояния', completed: false },
      { text: 'Проверка сборки и корректности работы без регрессий', completed: false }
    ]
  };
}

export async function generateCommitMessage(
  taskId?: string,
  taskTitle?: string,
  changedFiles?: string[]
): Promise<string> {
  if (taskId && taskTitle) {
    return `feat(${taskId}): ${taskTitle.toLowerCase()}`;
  }

  if (changedFiles && changedFiles.length > 0) {
    const firstFile = changedFiles[0];
    if (firstFile.includes('docs/') || firstFile.includes('decisions/')) {
      return 'docs: обновление документации и архитектурных решений';
    }
    if (firstFile.includes('test') || firstFile.includes('spec')) {
      return 'test: добавление модульных тестов';
    }
    return `feat: обновление модулей (${changedFiles.slice(0, 2).join(', ')})`;
  }

  return 'feat: реализация запланированных изменений';
}

export async function generatePRDraft(
  taskId?: string,
  taskTitle?: string,
  taskDescription?: string,
  branchName?: string
): Promise<{ title: string; description: string }> {
  const prTitle = taskId && taskTitle ? `${taskId}: ${taskTitle}` : `feat: ${branchName || 'новые изменения'}`;

  const prDesc = `## 📋 Описание изменений
${taskDescription || `В данном Pull Request реализованы изменения по задаче ${taskId || branchName}.`}

## 🔍 Что сделано:
- [x] Реализована логика модуля
- [x] Проверена совместимость с существующей архитектурой
- [x] Протестирована сборка и отсутствие ошибок

## 🔗 Связанные задачи:
- Backlog: ${taskId ? `\`${taskId}\`` : '—'}
`;

  return {
    title: prTitle,
    description: prDesc
  };
}
