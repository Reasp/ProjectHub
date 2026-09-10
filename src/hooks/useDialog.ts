import { useDialogStore } from '../store/useDialogStore';

export function useDialog() {
  const confirm = useDialogStore((state) => state.confirm);
  const prompt = useDialogStore((state) => state.prompt);
  const alert = useDialogStore((state) => state.alert);

  return { confirm, prompt, alert };
}
