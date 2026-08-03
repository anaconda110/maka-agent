import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../navigation/types';
import { useAppStore } from '../store/appStore';
import { MessageBubble } from '../components/MessageBubble';
import { SessionListItem } from '../components/SessionListItem';
import { newSessionTitle } from '../utils/session';

type ChatScreenProps = BottomTabScreenProps<MainTabParamList, 'Chat'>;

export function ChatScreen(_props: ChatScreenProps) {
  const sessions = useAppStore((state) => state.sessions);
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const createSession = useAppStore((state) => state.createSession);
  const messages = useAppStore((state) => state.messages);
  const appendMessage = useAppStore((state) => state.appendMessage);

  const [draft, setDraft] = useState('');

  const currentMessages = useMemo(
    () =>
      currentSessionId
        ? messages.filter((message) => message.sessionId === currentSessionId)
        : [],
    [messages, currentSessionId],
  );

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !currentSessionId) return;
    appendMessage({ sessionId: currentSessionId, role: 'user', text });
    setDraft('');
  };

  const handleNewSession = () => {
    createSession(newSessionTitle());
  };

  const renderSessionItem = ({ item }: { item: (typeof sessions)[number] }) => (
    <SessionListItem
      session={item}
      active={item.id === currentSessionId}
      onSelect={setCurrentSession}
    />
  );

  const sessionListHeader = (
    <View style={styles.sessionHeader}>
      <Text style={styles.sessionHeaderTitle}>会话</Text>
      <TouchableOpacity onPress={handleNewSession} style={styles.newButton}>
        <Text style={styles.newButtonText}>+ 新建</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <FlatList
        style={styles.sessionList}
        contentContainerStyle={styles.sessionListContent}
        data={sessions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={sessionListHeader}
        ListEmptyComponent={
          <Text style={styles.emptyHint}>暂无会话，点击右上角新建</Text>
        }
        renderItem={renderSessionItem}
      />
      <View style={styles.streamWrap}>
        <FlatList
          data={currentMessages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.streamContent}
          ListEmptyComponent={
            <Text style={styles.streamEmpty}>
              {currentSessionId ? '消息流占位：发送第一条消息' : '请选择或新建会话'}
            </Text>
          }
          renderItem={({ item }) => <MessageBubble message={item} />}
        />
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            placeholder={currentSessionId ? '输入消息…' : '先选择会话'}
            placeholderTextColor="#5a6066"
            editable={Boolean(currentSessionId)}
            multiline
            onChangeText={setDraft}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!currentSessionId || draft.trim().length === 0}
            style={[
              styles.sendButton,
              (!currentSessionId || draft.trim().length === 0) && styles.sendButtonDisabled,
            ]}
          >
            <Text style={styles.sendButtonText}>发送</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0d12',
  },
  sessionList: {
    maxHeight: 220,
    borderBottomWidth: 1,
    borderBottomColor: '#1d2026',
  },
  sessionListContent: {
    padding: 12,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sessionHeaderTitle: {
    color: '#f4f5f7',
    fontSize: 16,
    fontWeight: '700',
  },
  newButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  newButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyHint: {
    color: '#9aa0a6',
    fontSize: 13,
    paddingVertical: 12,
    textAlign: 'center',
  },
  streamWrap: {
    flex: 1,
  },
  streamContent: {
    padding: 12,
  },
  streamEmpty: {
    color: '#9aa0a6',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 24,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#1d2026',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#1d2026',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#f4f5f7',
    fontSize: 15,
    backgroundColor: '#0f1217',
  },
  sendButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  sendButtonDisabled: {
    backgroundColor: '#1d2026',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});