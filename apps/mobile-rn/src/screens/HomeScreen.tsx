import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';
import { SessionListItem } from '../components/SessionListItem';
import { newSessionTitle } from '../utils/session';

type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: HomeScreenProps) {
  const sessions = useAppStore((state) => state.sessions);
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const createSession = useAppStore((state) => state.createSession);

  const openChat = () => {
    navigation.navigate('Main');
  };

  const handleNewSession = () => {
    createSession(newSessionTitle());
    openChat();
  };

  const handleSelect = (id: string) => {
    setCurrentSession(id);
    openChat();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.title}>Maka</Text>
        <Text style={styles.subtitle}>Android · React Native</Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleNewSession}>
          <Text style={styles.primaryButtonText}>+ 新建会话</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.sectionTitle}>会话列表</Text>
      {sessions.length === 0 ? (
        <Text style={styles.emptyHint}>暂无会话，点击上方按钮开始</Text>
      ) : (
        sessions.map((session) => (
          <SessionListItem
            key={session.id}
            session={session}
            active={session.id === currentSessionId}
            onSelect={handleSelect}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0d12',
  },
  content: {
    padding: 24,
  },
  hero: {
    marginTop: 32,
    marginBottom: 24,
  },
  title: {
    color: '#f4f5f7',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#9aa0a6',
    fontSize: 16,
    marginTop: 8,
  },
  actions: {
    marginBottom: 24,
  },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  sectionTitle: {
    color: '#c7ccd1',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  emptyHint: {
    color: '#9aa0a6',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
});