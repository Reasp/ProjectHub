import { describe, expect, it } from 'vitest';
import {
  COMPUTER_TOOL_CATALOG,
  fromProxyToolName,
  getComputerToolSpec,
  reconcileRuntimeTools,
  toProxyToolName
} from '../../electron/services/computerToolCatalog';

/** Набор инструментов @zavora-ai/computer-use-mcp 7.4.0, полученный tools/list на Windows (2026-09-15). */
const RUNTIME_7_4_TOOLS = [
  'doctor', 'policy_status', 'agent_pointer', 'openai_computer', 'screenshot', 'zoom', 'left_click', 'right_click',
  'middle_click', 'double_click', 'triple_click', 'mouse_move', 'left_click_drag', 'mouse_drag', 'cursor_position',
  'left_mouse_down', 'left_mouse_up', 'scroll', 'type', 'key', 'hold_key', 'read_clipboard', 'write_clipboard',
  'open_application', 'get_frontmost_app', 'list_windows', 'discover_applications', 'list_running_apps', 'hide_app',
  'unhide_app', 'get_display_size', 'list_displays', 'get_window', 'get_cursor_window', 'activate_app', 'activate_window',
  'resize_window', 'wait', 'snapshot', 'get_ui_tree', 'get_focused_element', 'find_element', 'click_element', 'set_value',
  'press_button', 'select_menu_item', 'fill_form', 'run_script', 'get_app_dictionary', 'list_menu_bar', 'get_tool_guide',
  'get_app_capabilities', 'list_spaces', 'get_active_space', 'create_agent_space', 'move_window_to_space',
  'remove_window_from_space', 'destroy_space', 'get_tool_metadata', 'filesystem', 'process_kill', 'registry',
  'notification', 'multi_select', 'multi_edit', 'scrape', 'web_search', 'browser_tabs', 'browser_page_text', 'browser_find'
];

describe('computerToolCatalog: классификация — данные (decision-27 п. 3, AC #2)', () => {
  it('каждый инструмент рантайма 7.4 классифицирован', () => {
    expect(RUNTIME_7_4_TOOLS).toHaveLength(70);
    const r = reconcileRuntimeTools(RUNTIME_7_4_TOOLS);
    expect(r.unknown).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.exported.length + r.hidden.length).toBe(70);
  });

  it('observe: скриншот, дерево доступности, окна, курсор', () => {
    for (const name of ['screenshot', 'zoom', 'get_ui_tree', 'find_element', 'list_windows', 'cursor_position', 'get_frontmost_app']) {
      expect(getComputerToolSpec(name)?.class, name).toBe('observe');
    }
  });

  it('act: клики, ввод, скролл, фокус, буфер обмена', () => {
    for (const name of ['left_click', 'type', 'key', 'scroll', 'activate_window', 'write_clipboard', 'read_clipboard', 'click_element', 'set_value']) {
      expect(getComputerToolSpec(name)?.class, name).toBe('act');
    }
  });

  it('dangerous: скриптинг, файлы, процессы, реестр, удержание клавиш', () => {
    for (const name of ['run_script', 'filesystem', 'process_kill', 'registry', 'hold_key', 'left_mouse_down']) {
      expect(getComputerToolSpec(name)?.class, name).toBe('dangerous');
    }
  });

  it('обходящие поштучную политику и вне scope инструменты не экспортируются', () => {
    for (const name of ['openai_computer', 'get_tool_guide', 'doctor', 'policy_status', 'browser_find', 'web_search', 'scrape']) {
      expect(getComputerToolSpec(name)?.exported, name).toBe(false);
    }
  });

  it('инструменты с координатами описывают их форму; движущие курсор помечены', () => {
    expect(COMPUTER_TOOL_CATALOG.left_click.coords).toEqual({ coordinate: 'point' });
    expect(COMPUTER_TOOL_CATALOG.left_click_drag.coords).toEqual({ start_coordinate: 'point', coordinate: 'point' });
    expect(COMPUTER_TOOL_CATALOG.zoom.coords).toEqual({ region: 'region' });
    expect(COMPUTER_TOOL_CATALOG.mouse_drag.coords).toEqual({ path: 'points' });
    expect(COMPUTER_TOOL_CATALOG.multi_edit.coords).toEqual({ locs: 'locs' });
    expect(COMPUTER_TOOL_CATALOG.left_click.movesCursor).toBe(true);
    expect(COMPUTER_TOOL_CATALOG.click_element.movesCursor).toBeFalsy();
  });

  it('fail-closed: новый инструмент рантайма не экспортируется, пропавший — отмечается', () => {
    const r = reconcileRuntimeTools(['screenshot', 'teleport_cursor']);
    expect(r.exported).toEqual(['screenshot']);
    expect(r.unknown).toEqual(['teleport_cursor']);
    expect(r.missing).toContain('left_click');
    expect(getComputerToolSpec('teleport_cursor')).toBeUndefined();
    expect(getComputerToolSpec('toString')).toBeUndefined();
  });

  it('имена прокси: computer_<имя рантайма>', () => {
    expect(toProxyToolName('left_click')).toBe('computer_left_click');
    expect(fromProxyToolName('computer_left_click')).toBe('left_click');
    expect(fromProxyToolName('projecthub_list_tasks')).toBeNull();
  });
});
