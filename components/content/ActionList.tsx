import {HStack, ViewProps, VStack} from 'components/core';
import React from 'react';
import {TouchableOpacity} from 'react-native';
import {Body} from 'components/text';
import {colorLookup} from 'theme';
import {AntDesign} from '@expo/vector-icons';

interface Action<T> {
  label: string;
  data: T;
  action?: (label: string, data: T) => void;
  // Someday, might be nice to support nesting
  // children?: Action[];
}

export interface ActionListProps<T> extends ViewProps {
  actions: Action<T>[];
}

export function ActionList<T>({actions, ...props}: ActionListProps<T>) {
  return (
    <VStack {...props}>
      {actions.map(({label, data, action}) => (
        <TouchableOpacity onPress={() => action && action(label, data)} key={label}>
          <HStack borderBottomWidth={1} borderColor={colorLookup('light.200')} py={8} justifyContent="space-between">
            <Body style={{flex: 1, flexGrow: 1}}>{label}</Body>
            <AntDesign name={'right'} color={colorLookup('light.200')} size={24} />
          </HStack>
        </TouchableOpacity>
      ))}
    </VStack>
  );
}