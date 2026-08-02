import { StyleSheet, Text, View } from 'react-native';
import type { MessageMeta } from '../store/appStore';

interface MessageBubbleProps {
  message: MessageMeta;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  return (
    <View
      style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}
    >
      <Text style={styles.role}>
        {isUser ? '你' : message.role === 'system' ? '系统' : '助手'}
      </Text>
      <Text style={styles.text}>{message.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    marginVertical: 6,
    padding: 12,
    borderRadius: 12,
    maxWidth: '85%',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#2563eb',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#1d2026',
  },
  role: {
    color: '#9aa0a6',
    fontSize: 11,
    marginBottom: 4,
    fontWeight: '600',
  },
  text: {
    color: '#f4f5f7',
    fontSize: 15,
    lineHeight: 21,
  },
});