import * as Keychain from 'react-native-keychain';

const SERVICE = 'maka.mobile.llm';

export async function saveApiKey(apiKey: string): Promise<void> {
  if (apiKey.length === 0) {
    await Keychain.resetGenericPassword(SERVICE);
    return;
  }
  await Keychain.setGenericPassword('llm', apiKey, SERVICE);
}

export async function loadApiKey(): Promise<string> {
  const credentials = await Keychain.getGenericPassword(SERVICE);
  if (credentials === false) return '';
  return credentials.password;
}

export async function clearApiKey(): Promise<void> {
  await Keychain.resetGenericPassword(SERVICE);
}