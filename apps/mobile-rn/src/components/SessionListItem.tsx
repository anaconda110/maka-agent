import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { SessionMeta } from '../store/appStore';

interface SessionListItemProps {
  session: SessionMeta;
  active: boolean;
  onSelect: (id: string) => void;
}

export function SessionListItem({ session, active, onSelect }: SessionListItemProps) {
  return (
    <TouchableOpacity
      style={[styles.row, active && styles.activeRow]}
      onPress={() => onSelect(session.id)}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={styles.meta}>
          {new Date(session.createdAt).toLocaleString()}
        </Text>
      </View>
      {active ? <View style={styles.activeDot} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1d2026',
  },
  activeRow: {
    backgroundColor: '#15181d',
  },
  content: {
    flex: 1,
  },
  title: {
    color: '#f4f5f7',
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    color: '#9aa0a6',
    fontSize: 12,
    marginTop: 2,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563eb',
    marginLeft: 12,
  },
});