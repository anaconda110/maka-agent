/**
 * @format
 */
import { describe, expect, it, jest } from '@jest/globals';

// AsyncStorage is mocked globally in jest.setup.js so the zustand `persist`
// middleware can hydrate synchronously in tests.

import * as React from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';

import { MessageBubble } from '../src/components/MessageBubble';
import { SessionListItem } from '../src/components/SessionListItem';
import { ConnectionForm } from '../src/components/ConnectionForm';
import type {
  MessageMeta,
  SessionMeta,
  LlmConnectionConfig,
} from '../src/store/appStore';

const { act } = TestRenderer;

function render(el: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(el);
  });
  return tree as unknown as ReactTestRenderer;
}

describe('MessageBubble', () => {
  const base: MessageMeta = {
    id: 'm_1',
    sessionId: 's_1',
    role: 'user',
    text: 'hello',
    createdAt: 1_700_000_000_000,
  };

  it('renders the text for a user message', () => {
    const tree = render(<MessageBubble message={{ ...base, role: 'user', text: 'hi there' }} />);
    const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain('你');
    expect(texts).toContain('hi there');
  });

  it('labels an assistant message as 助手', () => {
    const tree = render(
      <MessageBubble message={{ ...base, role: 'assistant', text: 'yo' }} />,
    );
    const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain('助手');
    expect(texts).toContain('yo');
  });

  it('labels a system message as 系统', () => {
    const tree = render(
      <MessageBubble message={{ ...base, role: 'system', text: 'sys' }} />,
    );
    const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain('系统');
    expect(texts).toContain('sys');
  });
});

describe('SessionListItem', () => {
  const session: SessionMeta = {
    id: 's_42',
    title: 'Chat title',
    createdAt: 1_700_000_000_000,
  };

  it('renders the title and calls onSelect with the session id', () => {
    const onSelect = jest.fn();
    const tree = render(
      <SessionListItem session={session} active={false} onSelect={onSelect} />,
    );
    const texts = tree.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts).toContain('Chat title');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('passes the session id to onSelect when pressed', () => {
    const onSelect = jest.fn();
    const tree = render(
      <SessionListItem session={session} active={false} onSelect={onSelect} />,
    );
    // The root is a TouchableOpacity; invoke its onPress prop directly.
    const touchable = tree.root.findByType(TouchableOpacity);
    act(() => {
      touchable.props.onPress();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('s_42');
  });
});

describe('ConnectionForm', () => {
  const value: LlmConnectionConfig = {
    apiBaseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-abc',
    model: 'gpt-4o',
  };

  it('renders three TextInputs seeded from value', () => {
    const tree = render(<ConnectionForm value={value} onSubmit={jest.fn()} />);
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs).toHaveLength(3);
    const values = inputs.map((n) => n.props.value);
    expect(values).toContain('https://api.example.com/v1');
    expect(values).toContain('sk-abc');
    expect(values).toContain('gpt-4o');
  });

  it('calls onSubmit with the updated field when the API Base URL input blurs', () => {
    const onSubmit = jest.fn();
    const tree = render(<ConnectionForm value={value} onSubmit={onSubmit} />);
    const inputs = tree.root.findAllByType(TextInput);
    // The first input is the API Base URL field per ConnectionForm render order.
    const apiBaseInput = inputs[0];
    act(() => {
      apiBaseInput.props.onChangeText('https://new.api/v1');
    });
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => {
      apiBaseInput.props.onBlur();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      apiBaseUrl: 'https://new.api/v1',
      apiKey: 'sk-abc',
      model: 'gpt-4o',
    });
  });

  it('calls onSubmit with all three fields when the Model input blurs', () => {
    const onSubmit = jest.fn();
    const tree = render(<ConnectionForm value={value} onSubmit={onSubmit} />);
    const inputs = tree.root.findAllByType(TextInput);
    const modelInput = inputs[2];
    act(() => {
      modelInput.props.onChangeText('claude');
    });
    act(() => {
      modelInput.props.onBlur();
    });
    expect(onSubmit).toHaveBeenCalledWith({
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-abc',
      model: 'claude',
    });
  });
});