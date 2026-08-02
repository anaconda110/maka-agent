import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { LlmConnectionConfig } from '../store/appStore';

interface ConnectionFormProps {
  value: LlmConnectionConfig;
  onSubmit: (input: Partial<LlmConnectionConfig>) => void;
}

export function ConnectionForm({ value, onSubmit }: ConnectionFormProps) {
  const [apiBaseUrl, setApiBaseUrl] = useState(value.apiBaseUrl);
  const [apiKey, setApiKey] = useState(value.apiKey);
  const [model, setModel] = useState(value.model);

  const handleBlur = () => {
    onSubmit({ apiBaseUrl, apiKey, model });
  };

  return (
    <View style={styles.container}>
      <View style={styles.field}>
        <Text style={styles.label}>API Base URL</Text>
        <TextInput
          style={styles.input}
          value={apiBaseUrl}
          placeholder="https://api.example.com/v1"
          placeholderTextColor="#5a6066"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setApiBaseUrl}
          onBlur={handleBlur}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput
          style={styles.input}
          value={apiKey}
          placeholder="sk-..."
          placeholderTextColor="#5a6066"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          onChangeText={setApiKey}
          onBlur={handleBlur}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Model</Text>
        <TextInput
          style={styles.input}
          value={model}
          placeholder="gpt-4o"
          placeholderTextColor="#5a6066"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setModel}
          onBlur={handleBlur}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  field: {
    gap: 6,
  },
  label: {
    color: '#c7ccd1',
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#1d2026',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f4f5f7',
    fontSize: 15,
    backgroundColor: '#0f1217',
  },
});