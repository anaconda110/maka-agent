import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MainTabParamList } from '../navigation/types';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

type SettingsScreenProps = BottomTabScreenProps<MainTabParamList, 'Settings'>;

export function SettingsScreen(_props: SettingsScreenProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>设置</Text>
      <View style={styles.row}>
        <Text style={styles.label}>运行时连接</Text>
        <Text style={styles.value}>未连接</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>模型端点</Text>
        <Text style={styles.value}>云端优先</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0d12' },
  content: { padding: 24 },
  title: {
    color: '#f4f5f7',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 48,
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1d2026',
  },
  label: { color: '#c7ccd1', fontSize: 15 },
  value: { color: '#9aa0a6', fontSize: 15 },
});