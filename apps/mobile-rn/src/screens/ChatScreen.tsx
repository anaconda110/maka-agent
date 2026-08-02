import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MainTabParamList } from '../navigation/types';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

type ChatScreenProps = BottomTabScreenProps<MainTabParamList, 'Chat'>;

export function ChatScreen(_props: ChatScreenProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.title}>Maka Android</Text>
        <Text style={styles.subtitle}>React Native 脚手架已就绪</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.paragraph}>
          这是 Phase B 模块1 的最小可运行入口。会话 UI、runtime-host
          连接、权限/存储适配将在后续里程碑实现。
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0d12' },
  content: { padding: 24 },
  hero: { marginTop: 48, marginBottom: 32 },
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
  body: { flex: 1 },
  paragraph: {
    color: '#c7ccd1',
    fontSize: 15,
    lineHeight: 22,
  },
});