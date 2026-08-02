import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';
import { ConnectionForm } from '../components/ConnectionForm';

type SettingsScreenProps = BottomTabScreenProps<MainTabParamList, 'Settings'>;

export function SettingsScreen(_props: SettingsScreenProps) {
  const llmConnection = useAppStore((state) => state.llmConnection);
  const setLlmConnection = useAppStore((state) => state.setLlmConnection);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>设置</Text>
      <Text style={styles.sectionTitle}>模型连接</Text>
      <ConnectionForm value={llmConnection} onSubmit={setLlmConnection} />
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>已保存配置</Text>
        <Text style={styles.statusValue} numberOfLines={1}>
          {llmConnection.apiBaseUrl || '未配置'}
        </Text>
      </View>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>模型</Text>
        <Text style={styles.statusValue} numberOfLines={1}>
          {llmConnection.model || '未配置'}
        </Text>
      </View>
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
  title: {
    color: '#f4f5f7',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 48,
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#c7ccd1',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#1d2026',
  },
  statusLabel: {
    color: '#9aa0a6',
    fontSize: 13,
  },
  statusValue: {
    color: '#c7ccd1',
    fontSize: 13,
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
});