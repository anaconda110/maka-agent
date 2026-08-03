import { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './navigation/RootNavigator';
import { useAppStore } from './store/appStore';

export default function App() {
  const loadApiKeyFromKeychain = useAppStore((state) => state.loadApiKeyFromKeychain);

  useEffect(() => {
    void loadApiKeyFromKeychain();
  }, [loadApiKeyFromKeychain]);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}